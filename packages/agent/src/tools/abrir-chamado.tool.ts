import { z } from 'zod';
import { defineTool } from './types.js';
import { chamarErp, numeroPedidoSchema, pedidoDoCliente } from './shared.js';

export const MOTIVOS_CHAMADO = ['atraso', 'defeito', 'troca', 'devolucao', 'pagamento', 'outro'] as const;

export const abrirChamado = defineTool({
  name: 'abrir_chamado',
  description:
    'Abre um chamado para a equipe humana de atendimento e retorna o protocolo. Ação com efeito: exige confirmação. ' +
    'Use quando o problema não puder ser resolvido pelas outras tools (ex.: entrega atrasada, defeito, troca elegível) ' +
    'ou quando o cliente pedir para falar com um humano. Não use para perguntas que as tools de consulta respondem.',
  schema: z.object({
    numeroPedido: numeroPedidoSchema.optional(),
    motivo: z.enum(MOTIVOS_CHAMADO).describe('Categoria do chamado.'),
    descricao: z.string().min(10).max(1000).describe('Resumo objetivo do problema, com os fatos já apurados.'),
  }),
  policy: 'effect',
  summarize: ({ numeroPedido, motivo }) =>
    `Abrir chamado de "${motivo}"${numeroPedido ? ` para o pedido ${numeroPedido}` : ''} com a equipe de atendimento.`,
  async handler({ numeroPedido, motivo, descricao }, ctx) {
    if (numeroPedido) await pedidoDoCliente(numeroPedido, ctx);
    const chamado = await chamarErp(() => ctx.erp.abrirChamado({ cpf: ctx.cpf, numeroPedido, motivo, descricao }));
    return { protocolo: chamado.protocolo, criadoEm: chamado.criadoEm };
  },
});
