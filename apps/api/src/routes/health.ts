import type { FastifyPluginAsync } from 'fastify';
import type { ApiContext } from '../server.js';

export const healthRoutes: FastifyPluginAsync<{ ctx: ApiContext }> = async (app, { ctx }) => {
  app.get('/health', async () => ({ ok: true, hoje: ctx.hoje }));
};
