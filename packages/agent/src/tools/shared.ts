import { z } from 'zod';
import { ErpError, type Pedido } from '../ports/erp.js';
import { ToolError, type AgentContext } from './types.js';

export const numeroPedidoSchema = z
  .string()
  .regex(/^\d{3,10}$/, 'número do pedido deve conter apenas dígitos')
  .describe('Número do pedido, apenas dígitos (ex.: "1001").');

const MENSAGENS_ERP: Record<string, string> = {
  pedido_nao_encontrado: 'Pedido não encontrado.',
  rastreio_indisponivel: 'Este pedido ainda não possui código de rastreio.',
  pedido_sem_boleto: 'Este pedido não foi pago com boleto.',
  boleto_ja_pago: 'O boleto deste pedido já está pago.',
  pedido_cancelado: 'O pedido está cancelado.',
  pedido_ja_cancelado: 'O pedido já está cancelado.',
  pedido_ja_enviado: 'O pedido já foi enviado e não pode mais ser cancelado por aqui.',
  categoria_desconhecida: 'Não há política de troca cadastrada para esta categoria.',
};

/** Converte ErpError em ToolError com mensagem amigável; repassa outros erros. */
export async function chamarErp<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ErpError) {
      throw new ToolError(e.codigo, MENSAGENS_ERP[e.codigo] ?? 'Falha ao consultar o sistema de pedidos.');
    }
    throw e;
  }
}

/**
 * Busca o pedido garantindo que pertence ao cliente autenticado.
 * Pedido de outro cliente é tratado como inexistente (não vaza existência).
 */
export async function pedidoDoCliente(numero: string, ctx: AgentContext): Promise<Pedido> {
  const pedido = await chamarErp(() => ctx.erp.buscarPedido(numero));
  if (pedido.cpf !== ctx.cpf) {
    throw new ToolError('pedido_nao_encontrado', MENSAGENS_ERP.pedido_nao_encontrado!);
  }
  return pedido;
}

export function diasEntre(deIso: string, ateIso: string): number {
  const ms = Date.parse(`${ateIso}T00:00:00Z`) - Date.parse(`${deIso}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}
