import type { AgentContext, Tool } from '../tools/types.js';

export type Decision =
  | { kind: 'allow' }
  | { kind: 'confirm'; summary: string }
  | { kind: 'deny'; codigo: string; mensagem: string };

/**
 * Decide, no servidor, se uma chamada de tool pode executar. O prompt pode ser
 * manipulado; esta função não lê nada que venha do LLM além do nome da tool e
 * dos argumentos já validados.
 *
 * - sem cliente autenticado → nega tudo (RF04)
 * - `read` → executa
 * - `effect` → só com confirmação explícita do cliente (RF03)
 *
 * O filtro "pedido pertence ao cliente" fica nos handlers (`pedidoDoCliente`),
 * que usam `ctx.cpf` da sessão — nunca um CPF vindo dos argumentos.
 */
export class Authorizer {
  decide(tool: Tool, input: unknown, ctx: AgentContext): Decision {
    if (!/^\d{11}$/.test(ctx.cpf)) {
      return { kind: 'deny', codigo: 'nao_autenticado', mensagem: 'Cliente não identificado.' };
    }
    if (tool.policy === 'read') return { kind: 'allow' };
    const summary = tool.summarize?.(input) ?? `Executar ${tool.name}.`;
    return { kind: 'confirm', summary };
  }
}
