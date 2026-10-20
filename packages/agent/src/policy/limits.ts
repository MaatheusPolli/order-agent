export interface Limits {
  /** Máximo de chamadas ao LLM por mensagem do cliente (loop de tools). */
  maxIterations: number;
  /** Teto de custo acumulado por conversa, em centavos de dólar. */
  maxCostCents: number;
  /** Falhas de entendimento seguidas (RF06) antes de escalar para humano. */
  maxFalhas: number;
}

export const DEFAULT_LIMITS: Limits = { maxIterations: 8, maxCostCents: 50, maxFalhas: 3 };

/** Preço em US$ por milhão de tokens. */
export interface Pricing {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

const PRICING: Record<string, Pricing> = {
  'claude-opus-5': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-sonnet-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
};

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export function pricingFor(model: string): Pricing {
  const p = PRICING[model];
  if (!p) throw new Error(`Sem tabela de preço para o modelo ${model}`);
  return p;
}

/** Custo de uma chamada em centavos de dólar (fracionário). */
export function costCents(model: string, u: Usage): number {
  const p = pricingFor(model);
  const dolares =
    (u.input_tokens * p.input +
      u.output_tokens * p.output +
      (u.cache_creation_input_tokens ?? 0) * p.cacheWrite +
      (u.cache_read_input_tokens ?? 0) * p.cacheRead) /
    1_000_000;
  return dolares * 100;
}
