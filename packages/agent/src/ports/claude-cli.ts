import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { ContentBlock, LlmMessage, LlmPort, LlmRequest, MessageParam } from './llm.js';

/** Evento do `claude -p --output-format stream-json`. Só os campos que o adaptador usa. */
export interface CliEvent {
  type: string;
  event?: {
    type: string;
    index?: number;
    content_block?: { type: string; name?: string };
    delta?: { type: string; partial_json?: string };
  };
}

/**
 * Executa `claude -p` em modo stream-json: chama `onEvento` para cada evento intermediário
 * e resolve com o evento final `result`. Injetável: nos testes é substituída por uma função falsa.
 */
export type CliRunner = (args: string[], stdin: string, onEvento: (evento: CliEvent) => void) => Promise<CliOutput>;

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
- Use EXATAMENTE essas chaves ("text" e "tool_calls") em todas as respostas, inclusive depois de um [tool_result]. Não use outros formatos (ex.: "tipo", "tool_use", "raciocinio").
- Use apenas as tools listadas abaixo, com os campos do input_schema.
- Os resultados das tools aparecem na transcrição como [tool_result ...]; use-os antes de responder.
`;

/** Schema que o CLI força na saída: `structured_output` sempre tem este formato. */
const SCHEMA_RESPOSTA = JSON.stringify({
  type: 'object',
  properties: {
    text: { type: 'string' },
    tool_calls: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, input: { type: 'object' } },
        required: ['name', 'input'],
      },
    },
  },
  required: ['text', 'tool_calls'],
});

// max-turns 4: com 1 o CLI falha quando o modelo tenta a saída estruturada no segundo turno.
// stream-json + include-partial-messages: o JSON do StructuredOutput chega aos poucos (input_json_delta).
const CLI_FLAGS = [
  '-p',
  '--output-format',
  'stream-json',
  '--verbose',
  '--include-partial-messages',
  '--tools',
  '',
  '--max-turns',
  '4',
  '--json-schema',
  SCHEMA_RESPOSTA,
];

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
export interface RespostaJson {
  text?: string;
  tool_calls?: { name: string; input: unknown }[];
  /** Formatos alternativos que o modelo às vezes usa após um tool_result. */
  tool_use?: { name: string; input: unknown };
  type?: string;
  name?: string;
  input?: unknown;
}

export function extrairJson(texto: string): RespostaJson | null {
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
  structured_output?: unknown;
  is_error?: boolean;
  stop_reason?: string;
  usage?: CliUsage;
}

/**
 * Formatos que o modelo usa às vezes, em vez de `tool_calls`:
 * `{"tool_use": {name, input}}` ou `{"type": "tool_use", "name", "input"}`.
 */
function chamadasAlternativas(parsed: RespostaJson | null): { name: string; input: unknown }[] {
  if (!parsed) return [];
  if (parsed.tool_use?.name) return [parsed.tool_use];
  if (parsed.type === 'tool_use' && parsed.name) return [{ name: parsed.name, input: parsed.input }];
  return [];
}

/** Converte a saída do `claude -p --output-format json` numa mensagem no formato do runner. */
export function mensagemDoCli(out: CliOutput, model: string): LlmMessage {
  const texto = out.result ?? '';
  // Com --json-schema a resposta vem validada em structured_output; o parse do texto é só fallback.
  let parsed = (out.structured_output as RespostaJson | undefined) ?? extrairJson(texto);
  // Às vezes o modelo põe um JSON inteiro dentro do campo text: desaninha para não mostrar JSON ao cliente.
  const interno = parsed?.text?.trimStart().startsWith('{') ? extrairJson(parsed.text) : null;
  if (parsed && interno && typeof interno.text === 'string') {
    parsed = { text: interno.text, tool_calls: interno.tool_calls ?? parsed.tool_calls };
  }
  // Sem JSON válido não há tool call: o texto cru vai ao cliente como resposta final.
  const text = parsed?.text ?? (parsed ? '' : texto.trim());
  const calls = parsed?.tool_calls ?? chamadasAlternativas(parsed);

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

/**
 * Trecho já recebido do valor da chave "text" num JSON que ainda está chegando.
 * Desfaz as escapes; para antes de uma escape incompleta ou da aspa de fechamento.
 */
export function textoParcial(json: string): string {
  const abertura = /"text"\s*:\s*"/.exec(json);
  if (!abertura) return '';
  const inicio = abertura.index + abertura[0].length;
  // Texto que começa com "{" é JSON aninhado: não emite aos poucos (mensagemDoCli desaninha no fim).
  if (json[inicio] === '{' || inicio >= json.length) return '';
  let out = '';
  for (let i = inicio; i < json.length; i++) {
    const c = json[i];
    if (c === '"') return out;
    if (c !== '\\') {
      out += c;
      continue;
    }
    const esc = json[i + 1];
    if (esc === undefined) return out;
    if (esc === 'u') {
      const hex = json.slice(i + 2, i + 6);
      if (hex.length < 4) return out;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 5;
      continue;
    }
    out += ESCAPES[esc] ?? esc;
    i += 1;
  }
  return out;
}

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' };

/** Roda o `claude -p --output-format stream-json` como processo filho. */
export const executarCli =
  (bin: string): CliRunner =>
  (args, stdin, onEvento) =>
    new Promise((resolve, reject) => {
      // Sem shell: no Windows o shell corrompe o JSON do --json-schema. Só usa shell para .cmd/.bat.
      const proc = spawn(bin, args, { shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin) });
      let resultado: CliOutput | undefined;
      let buffer = '';
      let stderr = '';
      const processar = (linha: string) => {
        if (!linha.trim()) return;
        let evento: CliEvent & CliOutput;
        try {
          evento = JSON.parse(linha);
        } catch {
          return; // linha que não é JSON não interrompe o stream
        }
        if (evento.type === 'result') resultado = evento;
        else onEvento(evento);
      };
      proc.stdout.on('data', (d) => {
        buffer += d;
        let fim: number;
        while ((fim = buffer.indexOf('\n')) >= 0) {
          processar(buffer.slice(0, fim));
          buffer = buffer.slice(fim + 1);
        }
      });
      proc.stderr.on('data', (d) => (stderr += d));
      proc.on('error', reject);
      proc.on('close', (code) => {
        processar(buffer);
        // Mesmo com código 1 (ex.: recusa do classificador), o evento result indica o resultado.
        if (resultado) resolve(resultado);
        else reject(new Error(`claude CLI saiu com código ${code}: ${stderr.trim() || 'sem evento result'}`));
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
    this.model = opts.model ?? process.env.CLAUDE_CLI_MODEL ?? 'claude-opus-5-5';
    this.run = opts.run ?? executarCli(opts.bin ?? process.env.CLAUDE_CLI_BIN ?? 'claude');
  }

  async stream(req: LlmRequest, onText: (delta: string) => void): Promise<LlmMessage> {
    const system = [req.system, req.systemVolatile, PROTOCOLO].filter(Boolean).join('\n\n');
    const catalogo = JSON.stringify(req.tools, null, 2);
    const prompt = `# Tools disponíveis\n${catalogo}\n\n# Transcrição\n${serializarMensagens(req.messages)}\n\nResponda agora no protocolo JSON.`;

    const args = [...CLI_FLAGS, '--model', this.model, '--system-prompt', system];

    // O JSON da resposta chega no bloco StructuredOutput (input_json_delta). O texto livre do modelo é ignorado.
    let json = '';
    let blocoSaida = -1;
    let emitido = '';
    const out = await this.run(args, prompt, (evento) => {
      const e = evento.event;
      if (evento.type !== 'stream_event' || !e) return;
      // O CLI às vezes chama StructuredOutput mais de uma vez: cada tentativa começa um JSON novo.
      if (e.type === 'content_block_start' && e.content_block?.type === 'tool_use' && e.content_block.name === 'StructuredOutput') {
        blocoSaida = e.index ?? -1;
        json = '';
      }
      if (e.type === 'content_block_delta' && e.index === blocoSaida && e.delta?.type === 'input_json_delta') {
        json += e.delta.partial_json ?? '';
        const parcial = textoParcial(json);
        // Só emite o que continua o já enviado; se uma nova tentativa divergir, o texto final sai no fim.
        if (parcial.length > emitido.length && parcial.startsWith(emitido)) {
          onText(parcial.slice(emitido.length));
          emitido = parcial;
        }
      }
    });
    if (out.is_error && out.stop_reason !== 'refusal') throw new Error(`claude CLI retornou erro: ${out.result ?? 'sem detalhe'}`);

    const msg = mensagemDoCli(out, this.model);
    // O que não saiu no stream (ex.: resposta sem StructuredOutput, em texto cru) vai agora.
    const final = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    if (final.length > emitido.length && final.startsWith(emitido)) onText(final.slice(emitido.length));
    return msg;
  }
}
