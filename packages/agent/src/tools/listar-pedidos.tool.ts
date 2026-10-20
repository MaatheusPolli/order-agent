import { z } from 'zod';
import { defineTool } from './types.js';
import { chamarErp } from './shared.js';

export const listarPedidosCliente = defineTool({
  name: 'listar_pedidos_cliente',
  description:
    'Lista os pedidos do cliente autenticado (número, data, status e total). ' +
    'Use quando o cliente não souber o número do pedido ou pedir "meus pedidos". ' +
    'Não use se o cliente já informou o número (use buscar_pedido).',
  schema: z.object({}),
  policy: 'read',
  async handler(_input, ctx) {
    const pedidos = await chamarErp(() => ctx.erp.listarPedidos(ctx.cpf));
    return { pedidos };
  },
});
