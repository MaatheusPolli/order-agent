import { AnthropicLlm, type LlmPort } from './llm.js';
import { ClaudeCliLlm } from './claude-cli.js';

/**
 * Escolhe o LLM pela env LLM_PROVIDER:
 * - `claude-cli`: usa o Claude Code local (assinatura, sem chave de API);
 * - `anthropic` (padrão): API Messages, exige ANTHROPIC_API_KEY.
 */
export function llmFromEnv(env: NodeJS.ProcessEnv = process.env): LlmPort {
  if (env.LLM_PROVIDER === 'claude-cli') return new ClaudeCliLlm();
  return new AnthropicLlm();
}
