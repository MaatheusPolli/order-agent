import Anthropic from '@anthropic-ai/sdk';
import type { ToolDefinition } from '../tools/registry.js';

export type MessageParam = Anthropic.Beta.BetaMessageParam;
export type LlmMessage = Anthropic.Beta.BetaMessage;
export type ContentBlock = Anthropic.Beta.BetaContentBlock;

export interface LlmRequest {
  /** Parte estável do system prompt — recebe o breakpoint de cache (tools + system). */
  system: string;
  /** Contexto volátil (data de hoje etc.), depois do breakpoint para não invalidar o cache. */
  systemVolatile?: string;
  tools: ToolDefinition[];
  messages: MessageParam[];
}

/** Porta para o LLM. Nos testes é substituída por transcripts gravados. */
export interface LlmPort {
  readonly model: string;
  stream(req: LlmRequest, onText: (delta: string) => void): Promise<LlmMessage>;
}

export const DEFAULT_MODEL = 'claude-opus-5';

export class AnthropicLlm implements LlmPort {
  constructor(
    private readonly client: Anthropic = new Anthropic(),
    readonly model: string = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL,
  ) {}

  async stream(req: LlmRequest, onText: (delta: string) => void): Promise<LlmMessage> {
    const system: Anthropic.Beta.BetaTextBlockParam[] = [
      { type: 'text', text: req.system, cache_control: { type: 'ephemeral' } },
    ];
    if (req.systemVolatile) system.push({ type: 'text', text: req.systemVolatile });

    const stream = this.client.beta.messages.stream({
      model: this.model,
      max_tokens: 16000,
      output_config: { effort: 'medium' },
      // Recusa por classificador de segurança é refeita em outro modelo, na mesma chamada.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      tools: req.tools as Anthropic.Beta.BetaTool[],
      messages: req.messages,
    });
    stream.on('text', (delta) => onText(delta));
    return stream.finalMessage();
  }
}
