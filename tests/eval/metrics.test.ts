import { describe, expect, it } from 'vitest';
import { avaliarCaso, extrairEntidades, resumir, temFonte, type Execucao } from '../../eval/metrics.js';

const exec = (p: Partial<Execucao>): Execucao => ({
  toolsChamadas: [],
  toolsExecutadas: [],
  fontes: [],
  respostas: [],
  motivosParada: ['resposta_final'],
  ...p,
});

describe('extrairEntidades', () => {
  it('normaliza datas, valores, códigos, protocolos, pedidos e prazos', () => {
    const e = extrairEntidades(
      'O pedido 1001 (BR123456789) tinha previsão 2026-09-20, ou 20/09, ou 20 de setembro. ' +
        'Valor R$ 1.349,90. Protocolo CH-20260928-0001. Prazo de 7 dias.',
    );
    expect(e).toEqual(
      expect.arrayContaining([
        'pedido:1001',
        'codigo:BR123456789',
        'data:09-20',
        'valor:134990',
        'protocolo:CH-20260928-0001',
        'dias:7',
      ]),
    );
    expect(e.filter((x) => x === 'data:09-20')).toHaveLength(1);
  });

  it('ignora mês por extenso inválido', () => {
    expect(extrairEntidades('3 de algo')).toEqual([]);
  });
});

describe('temFonte', () => {
  const fontes = [
    JSON.stringify({ previsaoEntrega: '2026-09-20', totalCentavos: 19990, codigo: 'BR123456789', prazoArrependimentoDias: 7 }),
    'Cadê meu pedido 1001?',
  ];
  it.each([
    ['data:09-20', true],
    ['data:10-01', false],
    ['valor:19990', true],
    ['valor:500', false],
    ['codigo:BR123456789', true],
    ['pedido:1001', true],
    ['dias:7', true],
    ['dias:10', false],
    ['protocolo:CH-1', false],
  ])('%s → %s', (ent, ok) => expect(temFonte(ent, fontes)).toBe(ok));

  it('valor e data em formato brasileiro na fonte também contam', () => {
    expect(temFonte('valor:19990', ['custa R$ 199,90'])).toBe(true);
    expect(temFonte('data:09-20', ['chegou 20/09'])).toBe(true);
  });
});

describe('avaliarCaso', () => {
  it('aprova quando tool, conteúdo e fontes batem', () => {
    const r = avaliarCaso(
      { tools: ['rastrear_entrega'], naoChamar: ['solicitar_cancelamento'], deveConter: ['br123'] },
      exec({
        toolsChamadas: ['rastrear_entrega'],
        fontes: [JSON.stringify({ codigo: 'BR123456789', previsaoEntrega: '2026-09-20' })],
        respostas: ['Código BR123456789, previsão 20/09.'],
      }),
    );
    expect(r).toMatchObject({ toolCorreta: true, alucinadas: [], conteudoOk: true, escaladaCorreta: null, aprovado: true });
  });

  it('detecta alucinação de prazo e tool errada', () => {
    const r = avaliarCaso(
      { tools: ['rastrear_entrega'], naoChamar: ['buscar_pedido'] },
      exec({ toolsChamadas: ['buscar_pedido'], fontes: ['{}'], respostas: ['Chega em 05/10.'] }),
    );
    expect(r).toMatchObject({ toolCorreta: false, alucinadas: ['data:10-05'], aprovado: false });
  });

  it('escalada: por chamado executado ou por parada', () => {
    expect(avaliarCaso({ escalar: true }, exec({ toolsExecutadas: ['abrir_chamado'] })).escaladaCorreta).toBe(true);
    expect(avaliarCaso({ escalar: true }, exec({ motivosParada: ['escalada'] })).escaladaCorreta).toBe(true);
    expect(avaliarCaso({ escalar: true }, exec({ toolsChamadas: ['abrir_chamado'] })).escaladaCorreta).toBe(false);
    expect(avaliarCaso({ escalar: false }, exec({ motivosParada: ['escalada'] })).aprovado).toBe(false);
  });

  it('naoDeveConter reprova vazamento', () => {
    expect(avaliarCaso({ naoDeveConter: ['Bruno'] }, exec({ respostas: ['Pedido do Bruno'] })).conteudoOk).toBe(false);
  });
});

describe('resumir', () => {
  it('agrega percentuais e custo', () => {
    const base = { entidades: ['a', 'b'], alucinadas: [], conteudoOk: true, custoCents: 1.234 };
    const r = resumir([
      { ...base, toolCorreta: true, escaladaCorreta: true, aprovado: true },
      { ...base, toolCorreta: false, escaladaCorreta: null, alucinadas: ['x'], aprovado: false },
      { ...base, toolCorreta: true, escaladaCorreta: false, aprovado: false },
    ]);
    expect(r).toEqual({
      casos: 3,
      aprovados: 1,
      acertoTool: 66.7,
      taxaAlucinacao: 33.3,
      entidadesVerificadas: 6,
      entidadesAlucinadas: 1,
      acertoEscalada: 50,
      custoTotalCents: 3.7,
    });
  });

  it('lista vazia', () => {
    expect(resumir([])).toMatchObject({ casos: 0, acertoTool: 0, acertoEscalada: null });
  });
});
