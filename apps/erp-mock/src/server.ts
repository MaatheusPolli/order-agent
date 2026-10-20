import Fastify, { type FastifyInstance } from 'fastify';
import { HOJE, clientes, pedidos as seedPedidos, politicas } from './data/scenarios.js';
import type { Chamado, Pedido } from './data/types.js';

export * from './data/types.js';
export { HOJE } from './data/scenarios.js';

/**
 * ERP mock. Cada instância tem seu próprio estado (clonado da seed fixa),
 * então testes e execuções são reprodutíveis e isolados.
 */
export function buildErpServer(): FastifyInstance {
  const app = Fastify({ logger: false });
  const pedidos: Pedido[] = structuredClone(seedPedidos);
  const chamados: Chamado[] = [];
  let seqProtocolo = 0;

  const acharPedido = (numero: string) => pedidos.find((p) => p.numero === numero);

  app.get('/health', async () => ({ ok: true, hoje: HOJE }));

  app.get<{ Params: { cpf: string } }>('/clientes/:cpf', async (req, reply) => {
    const cliente = clientes.find((c) => c.cpf === req.params.cpf);
    if (!cliente) return reply.code(404).send({ erro: 'cliente_nao_encontrado' });
    return cliente;
  });

  app.get<{ Params: { cpf: string } }>('/clientes/:cpf/pedidos', async (req) =>
    pedidos
      .filter((p) => p.cpf === req.params.cpf)
      .map(({ numero, criadoEm, status, totalCentavos }) => ({ numero, criadoEm, status, totalCentavos })),
  );

  app.get<{ Params: { numero: string } }>('/pedidos/:numero', async (req, reply) => {
    const pedido = acharPedido(req.params.numero);
    if (!pedido) return reply.code(404).send({ erro: 'pedido_nao_encontrado' });
    const { rastreio: _r, boleto: _b, ...resumo } = pedido;
    return resumo;
  });

  app.get<{ Params: { numero: string } }>('/pedidos/:numero/rastreio', async (req, reply) => {
    const pedido = acharPedido(req.params.numero);
    if (!pedido) return reply.code(404).send({ erro: 'pedido_nao_encontrado' });
    if (!pedido.rastreio) return reply.code(404).send({ erro: 'rastreio_indisponivel' });
    return pedido.rastreio;
  });

  app.post<{ Params: { numero: string } }>('/pedidos/:numero/boleto/segunda-via', async (req, reply) => {
    const pedido = acharPedido(req.params.numero);
    if (!pedido) return reply.code(404).send({ erro: 'pedido_nao_encontrado' });
    if (!pedido.boleto) return reply.code(422).send({ erro: 'pedido_sem_boleto' });
    if (pedido.boleto.pago) return reply.code(409).send({ erro: 'boleto_ja_pago' });
    if (pedido.status === 'cancelado') return reply.code(409).send({ erro: 'pedido_cancelado' });
    const vencimento = addDias(HOJE, 3);
    pedido.boleto = { ...pedido.boleto, vencimento };
    return { linhaDigitavel: pedido.boleto.linhaDigitavel, vencimento, valorCentavos: pedido.boleto.valorCentavos };
  });

  app.post<{ Params: { numero: string } }>('/pedidos/:numero/cancelamento', async (req, reply) => {
    const pedido = acharPedido(req.params.numero);
    if (!pedido) return reply.code(404).send({ erro: 'pedido_nao_encontrado' });
    if (pedido.status === 'cancelado') return reply.code(409).send({ erro: 'pedido_ja_cancelado' });
    if (pedido.status === 'em_transporte' || pedido.status === 'entregue') {
      return reply.code(409).send({ erro: 'pedido_ja_enviado' });
    }
    pedido.status = 'cancelado';
    return { numero: pedido.numero, status: pedido.status };
  });

  app.get<{ Params: { categoria: string } }>('/politicas/troca/:categoria', async (req, reply) => {
    const politica = politicas.find((p) => p.categoria === req.params.categoria);
    if (!politica) return reply.code(404).send({ erro: 'categoria_desconhecida' });
    return politica;
  });

  app.post<{ Body: Partial<Chamado> }>('/chamados', async (req, reply) => {
    const { cpf, numeroPedido, motivo, descricao } = req.body ?? {};
    if (!cpf || !motivo || !descricao) return reply.code(400).send({ erro: 'campos_obrigatorios' });
    seqProtocolo += 1;
    const chamado: Chamado = {
      protocolo: `CH-${HOJE.replaceAll('-', '')}-${String(seqProtocolo).padStart(4, '0')}`,
      cpf,
      numeroPedido,
      motivo,
      descricao,
      criadoEm: HOJE,
    };
    chamados.push(chamado);
    return reply.code(201).send(chamado);
  });

  return app;
}

export function addDias(isoDate: string, dias: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
