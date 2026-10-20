import { describe, expect, it } from 'vitest';
import { costCents, DEFAULT_LIMITS, pricingFor } from '../../packages/agent/src/policy/limits.js';

describe('limits', () => {
  it('defaults do planejamento: 8 iterações', () => {
    expect(DEFAULT_LIMITS.maxIterations).toBe(8);
  });

  it('custo em centavos considera input, output e cache', () => {
    // 1M input a $5 = 500 centavos; 1M output a $25 = 2500
    expect(costCents('claude-opus-5', { input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(500);
    expect(costCents('claude-opus-5', { input_tokens: 0, output_tokens: 1_000_000 })).toBeCloseTo(2500);
    expect(
      costCents('claude-opus-5', {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 1_000_000,
        cache_creation_input_tokens: 1_000_000,
      }),
    ).toBeCloseTo(50 + 625);
    expect(costCents('claude-haiku-4-5', { input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: null }))
      .toBeCloseTo(100);
  });

  it('modelo sem preço falha alto', () => {
    expect(() => pricingFor('modelo-x')).toThrow(/preço/);
  });
});
