import type { FastifyPluginAsync } from 'fastify';
import { ErroIdentificacao } from '../sessions.js';
import type { ApiContext } from '../server.js';

export const conversasRoutes: FastifyPluginAsync<{ ctx: ApiContext }> = async (app, { ctx }) => {
  /** RF04: identificação por CPF + número de pedido. */
  app.post<{ Body: { cpf?: string; numeroPedido?: string } }>('/sessao', async (req, reply) => {
    try {
      const s = await ctx.sessions.identificar(String(req.body?.cpf ?? ''), String(req.body?.numeroPedido ?? ''));
      return { token: s.token };
    } catch (e) {
      if (e instanceof ErroIdentificacao) return reply.code(401).send({ erro: 'identificacao_invalida', mensagem: e.message });
      throw e;
    }
  });

  app.post('/conversas', async (req, reply) => {
    const s = ctx.autenticar(req, reply);
    if (!s) return reply;
    const reg = ctx.sessions.novaConversa(s.cpf, ctx.now());
    return reply.code(201).send({ id: reg.conv.id });
  });

  app.get('/conversas', async (req, reply) => {
    const s = ctx.autenticar(req, reply);
    if (!s) return reply;
    return ctx.sessions.conversasDe(s.cpf).map((r) => ({
      id: r.conv.id,
      criadaEm: r.criadaEm,
      custoCents: r.conv.costCents,
    }));
  });

  /** Painel (RF09): auditoria completa, timeline de tools e custo da conversa. */
  app.get<{ Params: { id: string } }>('/conversas/:id', async (req, reply) => {
    const s = ctx.autenticar(req, reply);
    if (!s) return reply;
    const reg = ctx.sessions.conversa(req.params.id, s.cpf);
    if (!reg) return reply.code(404).send({ erro: 'conversa_nao_encontrada' });
    const auditoria = await ctx.audit.byConversation(reg.conv.id);
    return {
      id: reg.conv.id,
      criadaEm: reg.criadaEm,
      custoCents: reg.conv.costCents,
      pendente: !!reg.conv.pending,
      auditoria,
    };
  });
};
