import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { AnthropicLlm, DEFAULT_MODEL } from '../../packages/agent/src/ports/llm.js';

/** Cliente falso: captura os params e simula o stream do SDK. */
function fakeClient() {
  const calls: any[] = [];
  const client = {
    beta: {
      messages: {
        stream(params: unknown) {
          calls.push(params);
          const handlers: ((d: string) => void)[] = [];
          return {
            on(_ev: 'text', h: (d: string) => void) {
              handlers.push(h);
              return this;
            },
            async finalMessage() {
              for (const h of handlers) h('Olá');
              return { stop_reason: 'end_turn', content: [], usage: { input_tokens: 1, output_tokens: 1 } };
            },
          };
        },
      },
    },
  };
  return { client: client as unknown as Anthropic, calls };
}

describe('AnthropicLlm', () => {
  it('monta o request com cache no system estável, contexto volátil depois e streaming de texto', async () => {
    const { client, calls } = fakeClient();
    const llm = new AnthropicLlm(client);
    const deltas: string[] = [];
    await llm.stream(
      { system: 'estável', systemVolatile: 'hoje', tools: [{ name: 't', description: 'd', input_schema: {} }], messages: [] },
      (d) => deltas.push(d),
    );
    expect(llm.model).toBe(process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL);
    expect(deltas).toEqual(['Olá']);
    const p = calls[0];
    expect(p.system).toEqual([
      { type: 'text', text: 'estável', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'hoje' },
    ]);
    expect(p.tools).toHaveLength(1);
    expect(p.fallbacks).toBe('default');
  });

  it('sem contexto volátil envia um único bloco de system', async () => {
    const { client, calls } = fakeClient();
    await new AnthropicLlm(client, 'claude-sonnet-5').stream({ system: 's', tools: [], messages: [] }, () => {});
    expect(calls[0].system).toHaveLength(1);
    expect(calls[0].model).toBe('claude-sonnet-5');
  });
});
