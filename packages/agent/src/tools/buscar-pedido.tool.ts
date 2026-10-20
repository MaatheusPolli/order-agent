import { z } from 'zod';
import { defineTool } from './types.js';
import { numeroPedidoSchema, pedidoDoCliente } from './shared.js';

export const buscarPedido = defineTool({
  name: 'buscar_pedido',
  description:
    'Retorna status, itens, valor, forma de pagamento e data de entrega de UM pedido do cliente autenticado. ' +
    'Use quando o cliente perguntar sobre a situação de um pedido específico. ' +
    'Não use para rastreio detalhado (use rastrear_entrega) nem para listar pedidos (use listar_pedidos_cliente).',
  schema: z.object({ numeroPedido: numeroPedidoSchema }),
  policy: 'read',
  async handler({ numeroPedido }, ctx) {
    const { cpf: _cpf, ...pedido } = await pedidoDoCliente(numeroPedido, ctx);
    return pedido;
  },
});
