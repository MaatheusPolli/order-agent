import { z } from 'zod';
import { defineTool } from './types.js';
import { chamarErp, diasEntre, numeroPedidoSchema, pedidoDoCliente } from './shared.js';

export const consultarPoliticaTroca = defineTool({
  name: 'consultar_politica_troca',
  description:
    'Retorna a política de troca/devolução aplicável a um pedido e calcula se ele ainda está dentro dos prazos ' +
    '(arrependimento e defeito), a partir da data de entrega. ' +
    'Use quando o cliente perguntar se pode trocar ou devolver. Não prometa troca: apenas informe a elegibilidade retornada.',
  schema: z.object({ numeroPedido: numeroPedidoSchema }),
  policy: 'read',
  async handler({ numeroPedido }, ctx) {
    const pedido = await pedidoDoCliente(numeroPedido, ctx);
    const politica = await chamarErp(() => ctx.erp.politicaTroca(pedido.categoria));
    if (!pedido.entregueEm) {
      return { politica, entregue: false, observacao: 'Prazos contam a partir da entrega; pedido ainda não entregue.' };
    }
    const diasDesdeEntrega = diasEntre(pedido.entregueEm, ctx.hoje);
    return {
      politica,
      entregue: true,
      entregueEm: pedido.entregueEm,
      diasDesdeEntrega,
      dentroPrazoArrependimento: diasDesdeEntrega <= politica.prazoArrependimentoDias,
      dentroPrazoDefeito: diasDesdeEntrega <= politica.prazoDefeitoDias,
    };
  },
});
