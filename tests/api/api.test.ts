import { describe, expect, it } from 'vitest';
import { buildApi } from '../../apps/api/src/server.js';
import { AgentRunner, createDefaultRegistry, InMemoryAuditLog, type LlmPort } from '../../packages/agent/src/index.js';
import { HOJE } from '../../apps/erp-mock/src/server.js';
import { createTestErp, CPF_ANA, CPF_CARLA } from '../helpers/erp.js';
import { ScriptedLlm, type RecordedTurn } from '../helpers/scripted-llm.js';

function montar(llm: LlmPort = new ScriptedLlm([])) {
  const erp = createTestErp();
  const audit = new InMemoryAuditLog();
  const runner = new AgentRunner({ llm, registry: createDefaultRegistry(), audit });
  const app = buildApi({ erp, runner, audit, hoje: HOJE, now: () => new Date('2026-09-28T12:00:00Z') });
  return { app, erp, audit };
}

type App = ReturnType<typeof montar>['app'];

async function login(app: App, cpf: string, numeroPedido: string) {
  const res = await app.inject({ method: 'POST', url: '/sessao', payload: { cpf, numeroPedido } });
  return { res, token: res.json().token as string, auth: { authorization: `Bearer ${res.json().token}` } };
}

async function novaConversa(app: App, auth: Record<string, string>) {
  return (await app.inject({ method: 'POST', url: '/conversas', headers: auth })).json().id as string;
}

function parseSse(body: string) {
  return body
    .split('\n\n')
    .filter(Boolean)
    .map((bloco) => {
      const event = /^event: (.+)$/m.exec(bloco)![1]!;
      const data = JSON.parse(/^data: (.+)$/m.exec(bloco)![1]!);
      return { event, data };
    });
}

const fim = (text: string): RecordedTurn => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });

describe('API — identificação (RF04)', () => {
  it('health', async () => {
    expect((await montar().app.inject({ method: 'GET', url: '/health' })).json()).toEqual({ ok: true, hoje: HOJE });
  });

  it('CPF + pedido do próprio cliente abre sessão (aceita CPF formatado)', async () => {
    const { res } = await login(montar().app, '111.111.111-11', '1001');
    expect(res.statusCode).toBe(200);
    expect(res.json().token).toMatch(/^[\w-]{32}$/);
  });

  it('pedido de outro CPF e pedido inexistente dão a mesma resposta', async () => {
    const { app } = montar();
    const outro = (await login(app, CPF_ANA, '2001')).res;
    const inexistente = (await login(app, CPF_ANA, '9999')).res;
    expect(outro.statusCode).toBe(401);
    expect(outro.json()).toEqual(inexistente.json());
    expect((await login(app, '123', '1001')).res.json().erro).toBe('identificacao_invalida');
    expect((await app.inject({ method: 'POST', url: '/sessao' })).statusCode).toBe(401);
  });

  it('rotas exigem token válido', async () => {
    const { app } = montar();
    for (const [method, url] of [
      ['POST', '/conversas'],
      ['GET', '/conversas'],
      ['GET', '/conversas/x'],
      ['POST', '/conversas/x/mensagens'],
      ['POST', '/conversas/x/confirmacoes'],
    ] as const) {
      const res = await app.inject({ method, url, headers: { authorization: 'Bearer falso' } });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('erro inesperado do ERP no login vira 500', async () => {
    const { app, erp } = montar();
    erp.buscarPedido = async () => {
      throw new Error('rede');
    };
    expect((await login(app, CPF_ANA, '1001')).res.statusCode).toBe(500);
  });
});

describe('API — chat via SSE (RF01)', () => {
  it('stream de texto, tool calls e evento end com custo', async () => {
    const llm = new ScriptedLlm([
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'rastrear_entrega', input: { numeroPedido: '1001' } }] },
      fim('Seu pedido 1001 está atrasado; previsão era 2026-09-20.'),
    ]);
    const { app } = montar(llm);
    const { auth } = await login(app, CPF_ANA, '1001');
    const id = await novaConversa(app, auth);

    const res = await app.inject({ method: 'POST', url: `/conversas/${id}/mensagens`, headers: auth, payload: { texto: 'cadê o 1001?' } });

    expect(res.headers['content-type']).toContain('text/event-stream');
    const eventos = parseSse(res.body);
    const tipos = eventos.map((e) => e.event);
    expect(tipos).toContain('tool_call');
    expect(tipos).toContain('tool_result');
    expect(tipos.filter((t) => t === 'text').length).toBeGreaterThan(2);
    const end = eventos.at(-1)!;
    expect(end.event).toBe('end');
    expect(end.data).toMatchObject({ reason: 'resposta_final' });
    expect(end.data.custoConversaCents).toBeGreaterThan(0);
  });

  it('valida texto e isola conversas entre clientes', async () => {
    const { app } = montar();
    const ana = await login(app, CPF_ANA, '1001');
    const carla = await login(app, CPF_CARLA, '3001');
    const id = await novaConversa(app, ana.auth);

    const vazio = await app.inject({ method: 'POST', url: `/conversas/${id}/mensagens`, headers: ana.auth, payload: { texto: ' ' } });
    expect(vazio.statusCode).toBe(400);
    const alheia = await app.inject({ method: 'POST', url: `/conversas/${id}/mensagens`, headers: carla.auth, payload: { texto: 'oi' } });
    expect(alheia.statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/conversas/${id}`, headers: carla.auth })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/conversas', headers: carla.auth })).json()).toEqual([]);
  });

  it('uma mensagem por vez por conversa', async () => {
    let liberar!: () => void;
    const lento: LlmPort = {
      model: 'claude-opus-5',
      stream: () =>
        new Promise((resolve) => {
          liberar = () =>
            resolve({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } } as any);
        }),
    };
    const { app } = montar(lento);
    const { auth } = await login(app, CPF_ANA, '1001');
    const id = await novaConversa(app, auth);
    const primeira = app.inject({ method: 'POST', url: `/conversas/${id}/mensagens`, headers: auth, payload: { texto: 'a' } });
    await new Promise((r) => setTimeout(r, 20));
    const segunda = await app.inject({ method: 'POST', url: `/conversas/${id}/mensagens`, headers: auth, payload: { texto: 'b' } });
    expect(segunda.statusCode).toBe(409);
    liberar();
    expect((await primeira).statusCode).toBe(200);
  });

  it('falha do LLM vira evento error e libera a conversa', async () => {
    const { app } = montar(new ScriptedLlm([]));
    const { auth } = await login(app, CPF_ANA, '1001');
    const id = await novaConversa(app, auth);
    const res = await app.inject({ method: 'POST', url: `/conversas/${id}/mensagens`, headers: auth, payload: { texto: 'oi' } });
    expect(parseSse(res.body).at(-1)).toMatchObject({ event: 'error' });
    expect(res.body).not.toContain('esgotado');
  });
});

describe('API — confirmação e painel', () => {
  it('confirmação pendente → POST confirmacoes executa; painel mostra auditoria e custo', async () => {
    const llm = new ScriptedLlm([
      {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'c1', name: 'solicitar_cancelamento', input: { numeroPedido: '3001' } }],
      },
      fim('Pedido 3001 cancelado.'),
    ]);
    const { app, erp } = montar(llm);
    const { auth } = await login(app, CPF_CARLA, '3001');
    const id = await novaConversa(app, auth);

    const r1 = parseSse(
      (await app.inject({ method: 'POST', url: `/conversas/${id}/mensagens`, headers: auth, payload: { texto: 'cancela o 3001' } })).body,
    );
    expect(r1.find((e) => e.event === 'confirmation_required')!.data.summary).toContain('não pode ser desfeita');
    expect(r1.at(-1)!.data).toMatchObject({ reason: 'aguardando_confirmacao', confirmations: [{ id: 'c1' }] });
    expect((await erp.buscarPedido('3001')).status).toBe('pago');

    const painelAntes = (await app.inject({ method: 'GET', url: `/conversas/${id}`, headers: auth })).json();
    expect(painelAntes.pendente).toBe(true);

    const r2 = parseSse(
      (await app.inject({ method: 'POST', url: `/conversas/${id}/confirmacoes`, headers: auth, payload: { decisoes: { c1: true, x: 'sim' } } })).body,
    );
    expect(r2.at(-1)!.data.reason).toBe('resposta_final');
    expect((await erp.buscarPedido('3001')).status).toBe('cancelado');

    const semPendencia = await app.inject({ method: 'POST', url: `/conversas/${id}/confirmacoes`, headers: auth, payload: {} });
    expect(semPendencia.statusCode).toBe(409);

    const painel = (await app.inject({ method: 'GET', url: `/conversas/${id}`, headers: auth })).json();
    expect(painel.pendente).toBe(false);
    expect(painel.custoCents).toBeGreaterThan(0);
    expect(painel.auditoria.map((e: any) => e.event.type)).toContain('confirmation_resolved');
    const lista = (await app.inject({ method: 'GET', url: '/conversas', headers: auth })).json();
    expect(lista).toEqual([{ id, criadaEm: '2026-09-28T12:00:00.000Z', custoCents: painel.custoCents }]);
  });

  it('confirmação em conversa inexistente → 404', async () => {
    const { app } = montar();
    const { auth } = await login(app, CPF_ANA, '1001');
    expect((await app.inject({ method: 'POST', url: '/conversas/nao-existe/confirmacoes', headers: auth })).statusCode).toBe(404);
  });
});
