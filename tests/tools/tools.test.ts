import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../../packages/agent/src/tools/registry.js';
import { ToolError, type AgentContext } from '../../packages/agent/src/tools/types.js';
import { ErpError, type ErpPort } from '../../packages/agent/src/ports/erp.js';
import { chamarErp } from '../../packages/agent/src/tools/shared.js';
import { CPF_ANA, CPF_BRUNO, CPF_CARLA, ctxPara } from '../helpers/erp.js';

const reg = createDefaultRegistry();
const run = (name: string, input: unknown, ctx: AgentContext) => reg.execute(name, input, ctx) as Promise<any>;
const codigo = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ToolError) return e.codigo;
    throw e;
  }
  throw new Error('esperava ToolError');
};

describe('buscar_pedido', () => {
  it('retorna o pedido sem o CPF', async () => {
    const p = await run('buscar_pedido', { numeroPedido: '1002' }, ctxPara(CPF_ANA));
    expect(p).toMatchObject({ numero: '1002', status: 'entregue', entregueEm: '2026-09-24' });
    expect(p.cpf).toBeUndefined();
  });
  it('pedido inexistente', async () => {
    expect(await codigo(run('buscar_pedido', { numeroPedido: '9999' }, ctxPara(CPF_ANA)))).toBe('pedido_nao_encontrado');
  });
});

describe('isolamento entre clientes (segurança)', () => {
  const casos: [string, object][] = [
    ['buscar_pedido', { numeroPedido: '2001' }],
    ['rastrear_entrega', { numeroPedido: '2001' }],
    ['consultar_politica_troca', { numeroPedido: '2001' }],
    ['gerar_segunda_via', { numeroPedido: '2001' }],
    ['solicitar_cancelamento', { numeroPedido: '2001' }],
    ['abrir_chamado', { numeroPedido: '2001', motivo: 'outro', descricao: 'tentativa de acesso' }],
  ];
  it.each(casos)('%s nega pedido de outro cliente como inexistente', async (tool, input) => {
    // Ana (autenticada) tenta acessar o pedido 2001, que é do Bruno.
    expect(await codigo(run(tool, input, ctxPara(CPF_ANA)))).toBe('pedido_nao_encontrado');
  });
  it('listar_pedidos_cliente ignora qualquer CPF vindo do LLM', async () => {
    const r = await run('listar_pedidos_cliente', { cpf: CPF_BRUNO }, ctxPara(CPF_ANA));
    expect(r.pedidos.map((p: any) => p.numero)).toEqual(['1001', '1002']);
  });
});

describe('rastrear_entrega', () => {
  it('sinaliza atraso quando a previsão já passou', async () => {
    const r = await run('rastrear_entrega', { numeroPedido: '1001' }, ctxPara(CPF_ANA));
    expect(r).toMatchObject({ codigo: 'BR123456789', atrasado: true, status: 'em_transporte' });
  });
  it('entregue não é atrasado', async () => {
    const r = await run('rastrear_entrega', { numeroPedido: '1002' }, ctxPara(CPF_ANA));
    expect(r.atrasado).toBe(false);
  });
  it('pedido sem rastreio', async () => {
    expect(await codigo(run('rastrear_entrega', { numeroPedido: '3001' }, ctxPara(CPF_CARLA)))).toBe(
      'rastreio_indisponivel',
    );
  });
});

describe('consultar_politica_troca', () => {
  it('entregue dentro do prazo de arrependimento', async () => {
    const r = await run('consultar_politica_troca', { numeroPedido: '1002' }, ctxPara(CPF_ANA));
    expect(r).toMatchObject({ diasDesdeEntrega: 4, dentroPrazoArrependimento: true, dentroPrazoDefeito: true });
    expect(r.politica.categoria).toBe('vestuario');
  });
  it('fora do arrependimento, dentro do prazo de defeito', async () => {
    const r = await run('consultar_politica_troca', { numeroPedido: '3002' }, ctxPara(CPF_CARLA));
    expect(r).toMatchObject({ diasDesdeEntrega: 82, dentroPrazoArrependimento: false, dentroPrazoDefeito: true });
  });
  it('não entregue', async () => {
    const r = await run('consultar_politica_troca', { numeroPedido: '1001' }, ctxPara(CPF_ANA));
    expect(r.entregue).toBe(false);
  });
});

describe('gerar_segunda_via', () => {
  it('boleto vencido gera nova via', async () => {
    const r = await run('gerar_segunda_via', { numeroPedido: '2001' }, ctxPara(CPF_BRUNO));
    expect(r).toMatchObject({ vencimento: '2026-10-01', valorCentavos: 34990 });
  });
  it('boleto já pago', async () => {
    expect(await codigo(run('gerar_segunda_via', { numeroPedido: '3001' }, ctxPara(CPF_CARLA)))).toBe('boleto_ja_pago');
  });
  it('pedido sem boleto', async () => {
    expect(await codigo(run('gerar_segunda_via', { numeroPedido: '1001' }, ctxPara(CPF_ANA)))).toBe('pedido_sem_boleto');
  });
});

describe('solicitar_cancelamento', () => {
  it('cancela pedido ainda não enviado', async () => {
    const r = await run('solicitar_cancelamento', { numeroPedido: '3001' }, ctxPara(CPF_CARLA));
    expect(r.status).toBe('cancelado');
  });
  it('recusa pedido já enviado', async () => {
    expect(await codigo(run('solicitar_cancelamento', { numeroPedido: '1001' }, ctxPara(CPF_ANA)))).toBe(
      'pedido_ja_enviado',
    );
  });
});

describe('abrir_chamado', () => {
  it('abre com pedido e retorna protocolo', async () => {
    const r = await run(
      'abrir_chamado',
      { numeroPedido: '1001', motivo: 'atraso', descricao: 'Previsão 20/09 já passou.' },
      ctxPara(CPF_ANA),
    );
    expect(r.protocolo).toMatch(/^CH-20260928-\d{4}$/);
  });
  it('abre sem pedido', async () => {
    const r = await run('abrir_chamado', { motivo: 'outro', descricao: 'Quero falar com um atendente.' }, ctxPara(CPF_ANA));
    expect(r.protocolo).toBeDefined();
  });
  it('valida descrição mínima', async () => {
    expect(await codigo(run('abrir_chamado', { motivo: 'outro', descricao: 'oi' }, ctxPara(CPF_ANA)))).toBe(
      'argumentos_invalidos',
    );
  });
});

describe('tradução de erros do ERP', () => {
  it('código desconhecido vira mensagem genérica; erros não-ERP são repassados', async () => {
    await expect(chamarErp(() => Promise.reject(new ErpError('xyz', 500)))).rejects.toThrow(
      'Falha ao consultar o sistema de pedidos.',
    );
    await expect(chamarErp(() => Promise.reject(new TypeError('rede')))).rejects.toThrow(TypeError);
  });
  it('resposta de erro sem código', async () => {
    const { HttpErpClient } = await import('../../packages/agent/src/ports/erp.js');
    const erp: ErpPort = new HttpErpClient('http://x', async () => new Response('{}', { status: 500 }));
    await expect(erp.buscarPedido('1')).rejects.toMatchObject({ codigo: 'erro_desconhecido', status: 500 });
  });
});
