import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { AgentEvent, RunResult } from '@order-agent/agent';
import type { ApiContext } from '../server.js';
import type { ConversaRegistro } from '../sessions.js';

/**
 * RF01: streaming da resposta via SSE. Cada AgentEvent vira um evento SSE
 * (`text`, `tool_call`, `tool_result`, `confirmation_required`, ...) e o
 * stream termina com `end`, que traz o RunResult (inclusive confirmações pendentes).
 */
export const chatRoutes: FastifyPluginAsync<{ ctx: ApiContext }> = async (app, { ctx }) => {
  const abrir = (id: string, cpf: string, reply: FastifyReply) => {
    const reg = ctx.sessions.conversa(id, cpf);
    if (!reg) {
      void reply.code(404).send({ erro: 'conversa_nao_encontrada' });
      return undefined;
    }
    if (reg.ocupada) {
      void reply.code(409).send({ erro: 'conversa_ocupada' });
      return undefined;
    }
    return reg;
  };

  app.post<{ Params: { id: string }; Body: { texto?: string } }>('/conversas/:id/mensagens', async (req, reply) => {
    const s = ctx.autenticar(req, reply);
    if (!s) return reply;
    const texto = String(req.body?.texto ?? '').trim();
    if (!texto || texto.length > 2000) return reply.code(400).send({ erro: 'texto_invalido' });
    const reg = abrir(req.params.id, s.cpf, reply);
    if (!reg) return reply;
    return streamSse(reply, reg, (emit) => ctx.runner.run(reg.conv, texto, contexto(ctx, s.cpf), emit));
  });

  app.post<{ Params: { id: string }; Body: { decisoes?: Record<string, boolean> } }>(
    '/conversas/:id/confirmacoes',
    async (req, reply) => {
      const s = ctx.autenticar(req, reply);
      if (!s) return reply;
      const reg = abrir(req.params.id, s.cpf, reply);
      if (!reg) return reply;
      if (!reg.conv.pending) return reply.code(409).send({ erro: 'sem_confirmacao_pendente' });
      const decisoes = Object.fromEntries(
        Object.entries(req.body?.decisoes ?? {}).map(([k, v]) => [k, v === true]),
      );
      return streamSse(reply, reg, (emit) => ctx.runner.resolve(reg.conv, decisoes, contexto(ctx, s.cpf), emit));
    },
  );
};

function contexto(ctx: ApiContext, cpf: string) {
  return { cpf, hoje: ctx.hoje, erp: ctx.erp };
}

async function streamSse(
  reply: FastifyReply,
  reg: ConversaRegistro,
  executar: (emit: (e: AgentEvent) => void) => Promise<RunResult>,
) {
  reg.ocupada = true;
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  const send = (event: string, data: unknown) => raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  try {
    const result = await executar((e) => send(e.type, e));
    send('end', { ...result, custoConversaCents: reg.conv.costCents });
  } catch (e) {
    // Detalhe só no log do servidor; o cliente recebe mensagem genérica.
    console.error(`[conversa ${reg.conv.id}] falha no agente:`, e);
    send('error', { mensagem: 'Falha ao processar a mensagem. Tente novamente.' });
  } finally {
    reg.ocupada = false;
    raw.end();
  }
}
