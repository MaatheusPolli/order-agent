import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { AgentRunner, AuditLog, ErpPort } from '@order-agent/agent';
import { SessionStore, type Sessao } from './sessions.js';
import { chatRoutes } from './routes/chat.js';
import { conversasRoutes } from './routes/conversas.js';
import { healthRoutes } from './routes/health.js';

export interface ApiDeps {
  erp: ErpPort;
  runner: AgentRunner;
  audit: AuditLog;
  /** Data de referência do negócio (o ERP mock tem data fixa). */
  hoje: string;
  now?: () => Date;
}

export interface ApiContext extends Required<ApiDeps> {
  sessions: SessionStore;
  autenticar(req: FastifyRequest, reply: FastifyReply): Sessao | undefined;
}

export function buildApi(deps: ApiDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  const sessions = new SessionStore(deps.erp);

  const ctx: ApiContext = {
    now: () => new Date(),
    ...deps,
    sessions,
    autenticar(req, reply) {
      const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
      const sessao = sessions.sessao(token);
      if (!sessao) void reply.code(401).send({ erro: 'nao_autenticado' });
      return sessao;
    },
  };

  app.register(healthRoutes, { ctx });
  app.register(conversasRoutes, { ctx });
  app.register(chatRoutes, { ctx });
  return app;
}
