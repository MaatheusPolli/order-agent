import { z } from 'zod';
import { defineTool } from './types.js';
import { chamarErp, numeroPedidoSchema, pedidoDoCliente } from './shared.js';

export const gerarSegundaVia = defineTool({
  name: 'gerar_segunda_via',
  description:
    'Emite a segunda via do boleto de um pedido, com novo vencimento. Ação com efeito: exige confirmação do cliente. ' +
    'Use somente quando o cliente pedir a segunda via. Não use para pedidos pagos com cartão/pix ou com boleto já pago.',
  schema: z.object({ numeroPedido: numeroPedidoSchema }),
  policy: 'effect',
  summarize: ({ numeroPedido }) => `Emitir segunda via do boleto do pedido ${numeroPedido}.`,
  async handler({ numeroPedido }, ctx) {
    await pedidoDoCliente(numeroPedido, ctx);
    return chamarErp(() => ctx.erp.gerarSegundaVia(numeroPedido));
  },
});
