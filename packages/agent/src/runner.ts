import { randomUUID } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import type { ContentBlock, LlmPort, MessageParam } from './ports/llm.js';
import { costCents, DEFAULT_LIMITS, type Limits } from './policy/limits.js';
import { Authorizer } from './policy/authorizer.js';
import { contextoVolatil, SYSTEM_PROMPT } from './prompts/system.js';
import { FALHAS_DE_ENTENDIMENTO, MENSAGEM_ESCALADA } from './prompts/escalation.js';
import type { ToolRegistry } from './tools/registry.js';
import { ToolError, type AgentContext } from './tools/types.js';
import type { AuditEvent, AuditLog } from './audit/types.js';

export type StopReason =
  | 'resposta_final'
  | 'aguardando_confirmacao'
  | 'limite_iteracoes'
  | 'limite_custo'
  | 'recusa'
  | 'escalada';

export type AgentEvent = AuditEvent | { type: 'text'; delta: string };

export interface PendingConfirmation {
  id: string;
  name: string;
  input: unknown;
  summary: string;
}

type ToolResultBlock = Anthropic.Beta.BetaToolResultBlockParam;

/** Turno pausado: resultados já prontos + slots aguardando decisão do cliente. */
interface PendingTurn {
  slots: (ToolResultBlock | { aguardando: PendingConfirmation })[];
}

/** Estado de uma conversa: histórico no formato da API, custo e confirmações pendentes. */
export interface Conversation {
  id: string;
  messages: MessageParam[];
  costCents: number;
  seq: number;
  /** Falhas de entendimento seguidas (zera quando uma tool dá certo). */
  falhas: number;
  pending?: PendingTurn;
}

export const newConversation = (id: string = randomUUID()): Conversation => ({
  id,
  messages: [],
  costCents: 0,
  seq: 0,
  falhas: 0,
});

export interface RunResult {
  reason: StopReason;
  text: string;
  iterations: number;
  confirmations?: PendingConfirmation[];
}

export const MENSAGENS_PARADA = {
  limite_iteracoes:
    'Não consegui concluir sua solicitação agora. Posso abrir um chamado para a nossa equipe de atendimento continuar daqui.',
  limite_custo:
    'Esta conversa atingiu o limite de atendimento automático. Vou encaminhar você para a nossa equipe humana.',
  recusa: 'Não posso ajudar com esse pedido por aqui. Posso abrir um chamado para a nossa equipe, se quiser.',
  escalada: MENSAGEM_ESCALADA,
} as const;

const RECUSADO_PELO_CLIENTE = {
  erro: 'recusado_pelo_cliente',
  mensagem: 'O cliente não confirmou a ação; nada foi executado.',
};

export interface RunnerDeps {
  llm: LlmPort;
  registry: ToolRegistry;
  limits?: Limits;
  authorizer?: Authorizer;
  audit?: AuditLog;
  now?: () => Date;
}

type Emit = (e: AgentEvent) => void;

/**
 * Loop explícito de tool use: LLM → tool_use → autoriza → executa → tool_result → repete,
 * até resposta final, pausa para confirmação ou um limite. Nunca recursivo.
 */
export class AgentRunner {
  private readonly limits: Limits;
  private readonly authorizer: Authorizer;
  private readonly now: () => Date;

  constructor(private readonly deps: RunnerDeps) {
    this.limits = deps.limits ?? DEFAULT_LIMITS;
    this.authorizer = deps.authorizer ?? new Authorizer();
    this.now = deps.now ?? (() => new Date());
  }

  /** Nova mensagem do cliente. Se havia confirmação pendente, ela é tratada como recusada. */
  async run(conv: Conversation, userText: string, ctx: AgentContext, onEvent: Emit = () => {}): Promise<RunResult> {
    return this.withAudit(conv, ctx, onEvent, async (emit) => {
      emit({ type: 'user_message', text: userText });
      const text: Anthropic.Beta.BetaTextBlockParam = { type: 'text', text: userText };
      if (conv.pending) {
        const results = this.fecharPendentes(conv, () => false, ctx, emit);
        conv.messages.push({ role: 'user', content: [...(await results), text] });
      } else {
        conv.messages.push({ role: 'user', content: userText });
      }
      return this.loop(conv, ctx, emit);
    });
  }

  /** Decisão do cliente sobre as ações pendentes (id → aprovado). Ausente = recusado. */
  async resolve(
    conv: Conversation,
    decisions: Record<string, boolean>,
    ctx: AgentContext,
    onEvent: Emit = () => {},
  ): Promise<RunResult> {
    if (!conv.pending) throw new Error('Não há confirmação pendente nesta conversa.');
    return this.withAudit(conv, ctx, onEvent, async (emit) => {
      const results = await this.fecharPendentes(conv, (id) => decisions[id] === true, ctx, emit);
      conv.messages.push({ role: 'user', content: results });
      if (this.contarFalhas(conv, results)) return this.stop(conv, 'escalada', 0, emit);
      return this.loop(conv, ctx, emit);
    });
  }

  private async loop(conv: Conversation, ctx: AgentContext, emit: Emit): Promise<RunResult> {
    const { llm, registry } = this.deps;
    let iterations = 0;
    while (true) {
      // Limites checados antes de cada chamada: o histórico termina em mensagem do usuário, sempre válido.
      if (conv.costCents >= this.limits.maxCostCents) return this.stop(conv, 'limite_custo', iterations, emit);
      if (iterations >= this.limits.maxIterations) return this.stop(conv, 'limite_iteracoes', iterations, emit);
      iterations += 1;

      const msg = await llm.stream(
        {
          system: SYSTEM_PROMPT,
          systemVolatile: contextoVolatil(ctx.hoje),
          tools: registry.definitions(),
          messages: conv.messages,
        },
        (delta) => emit({ type: 'text', delta }),
      );
      const custo = costCents(llm.model, msg.usage);
      conv.costCents += custo;
      emit({ type: 'llm_usage', model: llm.model, usage: msg.usage, costCents: custo });

      if (msg.stop_reason === 'refusal') return this.stop(conv, 'recusa', iterations, emit);

      conv.messages.push({ role: 'assistant', content: msg.content });
      const toolUses = msg.content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
      const text = textOf(msg.content);

      if (msg.stop_reason !== 'tool_use' || toolUses.length === 0) {
        emit({ type: 'done', reason: 'resposta_final', text });
        return { reason: 'resposta_final', text, iterations };
      }

      // Tools em paralelo; todos os tool_result voltam numa única mensagem, na ordem dos tool_use.
      const slots = await Promise.all(toolUses.map((tu) => this.processar(tu, ctx, emit)));
      const aguardando = slots.flatMap((s) => ('aguardando' in s ? [s.aguardando] : []));
      if (aguardando.length > 0) {
        conv.pending = { slots };
        emit({ type: 'done', reason: 'aguardando_confirmacao', text });
        return { reason: 'aguardando_confirmacao', text, iterations, confirmations: aguardando };
      }
      conv.messages.push({ role: 'user', content: slots as ToolResultBlock[] });
      if (this.contarFalhas(conv, slots as ToolResultBlock[])) return this.stop(conv, 'escalada', iterations, emit);
    }
  }

  /** Atualiza o contador de falhas de entendimento; true se chegou ao limite (RF06). */
  private contarFalhas(conv: Conversation, results: ToolResultBlock[]): boolean {
    const nomes = nomesDasTools(conv);
    for (const r of results) {
      if (!r.is_error) {
        // Listar pedidos não prova que o agente entendeu o cliente: não zera o contador.
        if (nomes.get(r.tool_use_id) !== 'listar_pedidos_cliente') conv.falhas = 0;
        continue;
      }
      const { erro } = JSON.parse(r.content as string) as { erro: string };
      if (FALHAS_DE_ENTENDIMENTO.has(erro)) conv.falhas += 1;
    }
    return conv.falhas >= this.limits.maxFalhas;
  }

  private async processar(
    tu: { id: string; name: string; input: unknown },
    ctx: AgentContext,
    emit: Emit,
  ): Promise<PendingTurn['slots'][number]> {
    emit({ type: 'tool_call', id: tu.id, name: tu.name, input: tu.input });
    let parsed;
    try {
      parsed = this.deps.registry.parse(tu.name, tu.input);
    } catch (e) {
      return this.resultado(tu, false, erroParaSaida(e), 0, emit);
    }
    const decision = this.authorizer.decide(parsed.tool, parsed.input, ctx);
    if (decision.kind === 'deny') {
      emit({ type: 'tool_denied', id: tu.id, name: tu.name, codigo: decision.codigo });
      return bloco(tu.id, false, { erro: decision.codigo, mensagem: decision.mensagem });
    }
    if (decision.kind === 'confirm') {
      const c: PendingConfirmation = { id: tu.id, name: tu.name, input: parsed.input, summary: decision.summary };
      emit({ type: 'confirmation_required', ...c });
      return { aguardando: c };
    }
    return this.executar(tu.id, tu.name, parsed.input, ctx, emit);
  }

  private async executar(id: string, name: string, input: unknown, ctx: AgentContext, emit: Emit) {
    const t0 = performance.now();
    try {
      // Revalida: executa exatamente os argumentos que o cliente viu, nada vindo de fora.
      const output = await this.deps.registry.execute(name, input, ctx);
      return this.resultado({ id, name }, true, output, performance.now() - t0, emit);
    } catch (e) {
      return this.resultado({ id, name }, false, erroParaSaida(e), performance.now() - t0, emit);
    }
  }

  private resultado(tu: { id: string; name: string }, ok: boolean, output: unknown, ms: number, emit: Emit) {
    emit({ type: 'tool_result', id: tu.id, name: tu.name, ok, output, latencyMs: Math.round(ms) });
    return bloco(tu.id, ok, output);
  }

  private async fecharPendentes(
    conv: Conversation,
    aprovado: (id: string) => boolean,
    ctx: AgentContext,
    emit: Emit,
  ): Promise<ToolResultBlock[]> {
    const { slots } = conv.pending!;
    conv.pending = undefined;
    return Promise.all(
      slots.map(async (s) => {
        if (!('aguardando' in s)) return s;
        const { id, name, input } = s.aguardando;
        const approved = aprovado(id);
        emit({ type: 'confirmation_resolved', id, name, approved });
        return approved ? this.executar(id, name, input, ctx, emit) : bloco(id, false, RECUSADO_PELO_CLIENTE);
      }),
    );
  }

  private stop(
    conv: Conversation,
    reason: keyof typeof MENSAGENS_PARADA,
    iterations: number,
    emit: Emit,
  ): RunResult {
    const text = MENSAGENS_PARADA[reason];
    conv.messages.push({ role: 'assistant', content: text });
    emit({ type: 'text', delta: text });
    emit({ type: 'done', reason, text });
    return { reason, text, iterations };
  }

  /** Encadeia as gravações de auditoria em ordem e só retorna depois de todas persistidas. */
  private async withAudit(
    conv: Conversation,
    ctx: AgentContext,
    onEvent: Emit,
    fn: (emit: Emit) => Promise<RunResult>,
  ): Promise<RunResult> {
    const { audit } = this.deps;
    let writes: Promise<void> = Promise.resolve();
    const emit: Emit = (e) => {
      onEvent(e);
      if (!audit || e.type === 'text') return;
      const entry = { conversationId: conv.id, seq: ++conv.seq, at: this.now().toISOString(), cpf: ctx.cpf, event: e };
      writes = writes.then(() => audit.append(entry));
    };
    try {
      return await fn(emit);
    } finally {
      await writes;
    }
  }
}

function bloco(id: string, ok: boolean, output: unknown): ToolResultBlock {
  return { type: 'tool_result', tool_use_id: id, content: JSON.stringify(output), ...(ok ? {} : { is_error: true }) };
}

function erroParaSaida(e: unknown) {
  return e instanceof ToolError
    ? { erro: e.codigo, mensagem: e.message }
    : { erro: 'falha_interna', mensagem: 'Falha inesperada ao executar a ferramenta.' };
}

function textOf(content: ContentBlock[]): string {
  return content
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/** Nome da tool de cada tool_use id da última mensagem do assistente. */
function nomesDasTools(conv: Conversation): Map<string, string> {
  const ultima = [...conv.messages].reverse().find((m) => m.role === 'assistant');
  const blocos = (ultima?.content ?? []) as ContentBlock[];
  return new Map(
    blocos.flatMap((b) => (b.type === 'tool_use' ? [[b.id, b.name] as [string, string]] : [])),
  );
}
