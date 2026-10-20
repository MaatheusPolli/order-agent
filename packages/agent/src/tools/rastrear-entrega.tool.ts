import { z } from 'zod';
import { defineTool } from './types.js';
import { chamarErp, numeroPedidoSchema, pedidoDoCliente } from './shared.js';

export const rastrearEntrega = defineTool({
  name: 'rastrear_entrega',
  description:
    'Retorna código de rastreio, transportadora, previsão de entrega e eventos de transporte de um pedido, ' +
    'e indica se a entrega está atrasada em relação à previsão. ' +
    'Use para "cadê meu pedido?" / "quando chega?". Não invente previsão se a tool retornar erro de rastreio indisponível.',
  schema: z.object({ numeroPedido: numeroPedidoSchema }),
  policy: 'read',
  async handler({ numeroPedido }, ctx) {
    const pedido = await pedidoDoCliente(numeroPedido, ctx);
    const rastreio = await chamarErp(() => ctx.erp.rastrear(numeroPedido));
    const atrasado = pedido.status !== 'entregue' && rastreio.previsaoEntrega < ctx.hoje;
    return { status: pedido.status, ...rastreio, atrasado };
  },
});
