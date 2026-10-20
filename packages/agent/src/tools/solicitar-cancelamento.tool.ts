import { z } from 'zod';
import { defineTool } from './types.js';
import { chamarErp, numeroPedidoSchema, pedidoDoCliente } from './shared.js';

export const solicitarCancelamento = defineTool({
  name: 'solicitar_cancelamento',
  description:
    'Cancela um pedido que ainda não foi enviado. Ação IRREVERSÍVEL: exige confirmação explícita do cliente. ' +
    'Use apenas quando o cliente pedir claramente o cancelamento. Não use para pedidos em transporte ou entregues ' +
    '(nesses casos, oriente sobre a política de troca ou abra um chamado).',
  schema: z.object({ numeroPedido: numeroPedidoSchema }),
  policy: 'effect',
  summarize: ({ numeroPedido }) => `Cancelar o pedido ${numeroPedido}. Esta ação não pode ser desfeita.`,
  async handler({ numeroPedido }, ctx) {
    await pedidoDoCliente(numeroPedido, ctx);
    return chamarErp(() => ctx.erp.solicitarCancelamento(numeroPedido));
  },
});
