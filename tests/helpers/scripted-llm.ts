import { readFileSync } from 'node:fs';
import type { LlmMessage, LlmPort, LlmRequest } from '../../packages/agent/src/ports/llm.js';

/** Uma resposta gravada do modelo (subconjunto de BetaMessage relevante ao runner). */
export interface RecordedTurn {
  content: unknown[];
  stop_reason: string;
  usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number };
}

/**
 * LLM determinístico: reproduz respostas gravadas em ordem, emite o texto em
 * deltas (como o streaming real) e guarda cada request para asserções.
 */
export class ScriptedLlm implements LlmPort {
  readonly model = 'claude-opus-5';
  readonly requests: LlmRequest[] = [];
  private i = 0;

  constructor(private readonly turns: RecordedTurn[]) {}

  static fromFixture(nome: string): ScriptedLlm {
    const url = new URL(`../fixtures/llm-transcripts/${nome}.json`, import.meta.url);
    return new ScriptedLlm(JSON.parse(readFileSync(url, 'utf8')));
  }

  async stream(req: LlmRequest, onText: (delta: string) => void): Promise<LlmMessage> {
    // Snapshot: o runner muta o array de mensagens depois.
    this.requests.push({ ...req, messages: structuredClone(req.messages) });
    const turn = this.turns[this.i++];
    if (!turn) throw new Error('ScriptedLlm: transcript esgotado');
    for (const b of turn.content as { type: string; text?: string }[]) {
      if (b.type === 'text' && b.text) for (const pedaco of b.text.match(/.{1,12}/gs) ?? []) onText(pedaco);
    }
    return {
      id: `msg_${this.i}`,
      type: 'message',
      role: 'assistant',
      model: this.model,
      content: turn.content,
      stop_reason: turn.stop_reason,
      usage: turn.usage ?? { input_tokens: 1000, output_tokens: 100 },
    } as unknown as LlmMessage;
  }
}
