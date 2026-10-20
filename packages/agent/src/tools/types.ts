import type { z } from 'zod';
import type { ErpPort } from '../ports/erp.js';

export interface AgentContext {
  /** CPF do cliente autenticado (RF04). Vem da sessão no servidor, nunca do LLM. */
  cpf: string;
  /** Data de referência "hoje" (ISO yyyy-mm-dd), injetável para reprodutibilidade. */
  hoje: string;
  erp: ErpPort;
}

export type ToolPolicy = 'read' | 'effect';

export interface Tool<I = any, O = unknown> {
  name: string;
  /** Escrita para o LLM: quando usar e quando NÃO usar. */
  description: string;
  schema: z.ZodType<I, z.ZodTypeDef, any>;
  policy: ToolPolicy;
  /** Para tools de efeito: resumo legível do que será feito, mostrado na confirmação. */
  summarize?(input: I): string;
  handler(input: I, ctx: AgentContext): Promise<O>;
}

/**
 * Erro esperado de uma tool — vira `tool_result` com `is_error` para o LLM,
 * com um código estável e uma mensagem que ele pode repassar ao cliente.
 */
export class ToolError extends Error {
  constructor(
    readonly codigo: string,
    message: string,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

export function defineTool<I, O>(tool: Tool<I, O>): Tool<I, O> {
  return tool;
}
