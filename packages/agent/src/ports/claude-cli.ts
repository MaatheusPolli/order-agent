import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { ContentBlock, LlmMessage, LlmPort, LlmRequest, MessageParam } from './llm.js';

/**
 * Executa `claude -p` com o prompt em stdin e devolve o stdout.
 * Injetável: nos testes é substituída por uma função falsa.
 */
export type CliRunner = (args: string[], stdin: string) => Promise<string>;

export interface ClaudeCliOptions {
  /** Binário do Claude Code. Padrão: env CLAUDE_CLI_BIN ou `claude`. */
  bin?: string;
  /** Modelo passado ao CLI (alias ou id completo). */
  model?: string;
  run?: CliRunner;
}

/** Formato que o modelo deve devolver. Tool use é simulado por texto JSON. */
const PROTOCOLO = `
# Protocolo de resposta (obrigatório)
Você TEM as tools listadas abaixo e DEVE usá-las, pelo campo "tool_calls", sempre que a resposta depender de dados do pedido, entrega, boleto, política ou chamado. Nunca diga que não tem acesso às tools: peça a tool e aguarde o resultado.
Quando precisar de uma tool, responda com "text" vazio e a(s) chamada(s) em "tool_calls". Só responda ao cliente em "text" depois de ter os resultados necessários.
Responda SOMENTE com um objeto JSON válido, sem markdown e sem texto fora do JSON, no formato:
{"text": "<mensagem ao cliente, pode ser vazia se só houver tool_calls>", "tool_calls": [{"name": "<nome exato da tool>", "input": { ... }}]}
- "tool_calls" vazio ([]) significa que a resposta final está em "text".
- Use apenas as tools listadas abaixo, com os campos do input_schema.
- Os resultados das tools aparecem na transcrição como [tool_result ...]; use-os antes de responder.
`;

const CLI_FLAGS = ['-p', '--output-format', 'json', '--tools', '', '--max-turns', '1'];

/** Serializa o histórico no formato de texto que vai no prompt do CLI. */
export function serializarMensagens(messages: MessageParam[]): string {
  return messages
    .map((m) => {
      const conteudo =
        typeof m.content === 'string'
          ? m.content
          : (m.content as ContentBlock[] | unknown[])
              .map((b) => serializarBloco(b as Record<string, unknown>))
              .join('\n');
      return `[${m.role}]\n${conteudo}`;
    })
    .join('\n\n');
}

function serializarBloco(b: Record<string, unknown>): string {
  switch (b.type) {
    case 'text':
      return String(b.text ?? '');
    case 'tool_use':
      return `[tool_use id=${b.id} name=${b.name}] ${JSON.stringify(b.input)}`;
    case 'tool_result': {
      const erro = b.is_error ? ' is_error=true' : '';
      return `[tool_result id=${b.tool_use_id}${erro}] ${String(b.content ?? '')}`;
    }
    default:
      return JSON.stringify(b);
  }
}

/** Extrai o primeiro objeto JSON do texto (tolera cercas ```json). */
export function extrairJson(texto: string): { text?: string; tool_calls?: { name: string; input: unknown }[] } | null {
  const limpo = texto.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const inicio = limpo.indexOf('{');
  const fim = limpo.lastIndexOf('}');
  if (inicio < 0 || fim < inicio) return null;
  try {
    return JSON.parse(limpo.slice(inicio, fim + 1));
  } catch {
    return null;
  }
}

interface CliUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface CliOutput {
  result?: string;
  is_error?: boolean;
  stop_reason?: string;
  usage?: CliUsage;
}

/** Converte a saída do `claude -p --output-format json` numa mensagem no formato do runner. */
export function mensagemDoCli(out: CliOutput, model: string): LlmMessage {
  const texto = out.result ?? '';
  const parsed = extrairJson(texto);
  // Sem JSON válido não há tool call: o texto cru vai ao cliente como resposta final.
  const text = parsed?.text ?? (parsed ? '' : texto.trim());
  const calls = parsed?.tool_calls ?? [];

  const content: ContentBlock[] = [];
  if (text) content.push({ type: 'text', text, citations: null } as ContentBlock);
  for (const c of calls) {
    content.push({ type: 'tool_use', id: `toolu_${randomUUID().replace(/-/g, '').slice(0, 24)}`, name: c.name, input: c.input ?? {} } as ContentBlock);
  }

  const u = out.usage ?? {};
  return {
    id: `msg_${randomUUID().slice(0, 12)}`,
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: out.stop_reason === 'refusal' ? 'refusal' : calls.length > 0 ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: u.input_tokens ?? 0,
      output_tokens: u.output_tokens ?? 0,
      cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
    },
  } as unknown as LlmMessage;
}

/** Roda o `claude -p` como processo filho. */
export const executarCli =
  (bin: string): CliRunner =>
  (args, stdin) =>
    new Promise((resolve, reject) => {
      const proc = spawn(bin, args, { shell: process.platform === 'win32' });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d) => (stdout += d));
      proc.stderr.on('data', (d) => (stderr += d));
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) resolve(stdout);
        // Recusa do classificador de segurança sai com código 1, mas o JSON vem no stdout.
        else if (stdout.includes('"stop_reason":"refusal"')) resolve(stdout);
        else reject(new Error(`claude CLI saiu com código ${code}: ${stderr.trim() || stdout.slice(0, 500)}`));
      });
      proc.stdin.end(stdin);
    });

/**
 * LlmPort sobre o Claude Code local (assinatura do usuário, sem chave de API).
 * Não há streaming nem tool use nativo: o protocolo JSON do prompt substitui o `tool_use`.
 */
export class ClaudeCliLlm implements LlmPort {
  readonly model: string;
  private readonly run: CliRunner;

  constructor(opts: ClaudeCliOptions = {}) {
    this.model = opts.model ?? process.env.CLAUDE_CLI_MODEL ?? 'claude-opus-5';
    this.run = opts.run ?? executarCli(opts.bin ?? process.env.CLAUDE_CLI_BIN ?? 'claude');
  }

  async stream(req: LlmRequest, onText: (delta: string) => void): Promise<LlmMessage> {
    const system = [req.system, req.systemVolatile, PROTOCOLO].filter(Boolean).join('\n\n');
    const catalogo = JSON.stringify(req.tools, null, 2);
    const prompt = `# Tools disponíveis\n${catalogo}\n\n# Transcrição\n${serializarMensagens(req.messages)}\n\nResponda agora no protocolo JSON.`;

    const args = [...CLI_FLAGS, '--model', this.model, '--system-prompt', system];
    const raw = await this.run(args, prompt);
    const out = JSON.parse(raw) as CliOutput;
    if (out.is_error && out.stop_reason !== 'refusal') throw new Error(`claude CLI retornou erro: ${out.result ?? 'sem detalhe'}`);

    const msg = mensagemDoCli(out, this.model);
    for (const b of msg.content) if (b.type === 'text') onText(b.text);
    return msg;
  }
}
