import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addDias, buildErpServer, HOJE } from '../../apps/erp-mock/src/server.js';

let erp: FastifyInstance;
beforeEach(() => {
  erp = buildErpServer();
});

const get = (url: string) => erp.inject({ method: 'GET', url });
const post = (url: string, payload?: object) => erp.inject({ method: 'POST', url, payload });

describe('ERP mock', () => {
  it('health expõe a data de referência fixa', async () => {
    expect((await get('/health')).json()).toEqual({ ok: true, hoje: HOJE });
  });

  it('busca cliente e 404 para desconhecido', async () => {
    expect((await get('/clientes/11111111111')).json().nome).toBe('Ana Souza');
    expect((await get('/clientes/00000000000')).statusCode).toBe(404);
  });

  it('lista apenas pedidos do cliente', async () => {
    const lista = (await get('/clientes/11111111111/pedidos')).json();
    expect(lista.map((p: { numero: string }) => p.numero)).toEqual(['1001', '1002']);
  });

  it('pedido sem expor rastreio/boleto; 404 inexistente', async () => {
    const p = (await get('/pedidos/2001')).json();
    expect(p.status).toBe('aguardando_pagamento');
    expect(p.boleto).toBeUndefined();
    expect((await get('/pedidos/9999')).statusCode).toBe(404);
  });

  it('rastreio: atrasado, sem rastreio e inexistente', async () => {
    const r = (await get('/pedidos/1001/rastreio')).json();
    expect(r.previsaoEntrega < HOJE).toBe(true);
    const sem = await get('/pedidos/3001/rastreio');
    expect(sem.statusCode).toBe(404);
    expect(sem.json().erro).toBe('rastreio_indisponivel');
    expect((await get('/pedidos/9999/rastreio')).statusCode).toBe(404);
  });

  it('segunda via renova vencimento de boleto vencido', async () => {
    const res = await post('/pedidos/2001/boleto/segunda-via');
    expect(res.statusCode).toBe(200);
    expect(res.json().vencimento).toBe(addDias(HOJE, 3));
  });

  it('segunda via: erros de boleto pago, sem boleto, inexistente', async () => {
    expect((await post('/pedidos/3001/boleto/segunda-via')).json().erro).toBe('boleto_ja_pago');
    expect((await post('/pedidos/1001/boleto/segunda-via')).json().erro).toBe('pedido_sem_boleto');
    expect((await post('/pedidos/9999/boleto/segunda-via')).statusCode).toBe(404);
  });

  it('cancelamento respeita o status', async () => {
    expect((await post('/pedidos/3001/cancelamento')).json().status).toBe('cancelado');
    expect((await post('/pedidos/3001/cancelamento')).json().erro).toBe('pedido_ja_cancelado');
    expect((await post('/pedidos/1001/cancelamento')).json().erro).toBe('pedido_ja_enviado');
    expect((await post('/pedidos/9999/cancelamento')).statusCode).toBe(404);
  });

  it('estado é isolado por instância', async () => {
    await post('/pedidos/3001/cancelamento');
    const outra = buildErpServer();
    const p = (await outra.inject({ method: 'GET', url: '/pedidos/3001' })).json();
    expect(p.status).toBe('pago');
  });

  it('segunda via de pedido cancelado com boleto é recusada', async () => {
    await post('/pedidos/2001/cancelamento');
    expect((await post('/pedidos/2001/boleto/segunda-via')).json().erro).toBe('pedido_cancelado');
  });

  it('política de troca por categoria', async () => {
    expect((await get('/politicas/troca/vestuario')).json().prazoArrependimentoDias).toBe(30);
    expect((await get('/politicas/troca/brinquedos')).statusCode).toBe(404);
  });

  it('abre chamados com protocolo sequencial e valida campos', async () => {
    const a = await post('/chamados', { cpf: '11111111111', numeroPedido: '1001', motivo: 'atraso', descricao: 'x' });
    expect(a.statusCode).toBe(201);
    expect(a.json().protocolo).toBe('CH-20260928-0001');
    const b = await post('/chamados', { cpf: '11111111111', motivo: 'outro', descricao: 'y' });
    expect(b.json().protocolo).toBe('CH-20260928-0002');
    expect((await post('/chamados', { cpf: '1' })).statusCode).toBe(400);
  });
});
