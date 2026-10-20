import { describe, expect, it } from 'vitest';
import { carregarCasos, relatorioMarkdown, rodarEval, type Caso } from '../../eval/run-eval.js';
import { ScriptedLlm, type RecordedTurn } from '../helpers/scripted-llm.js';

const fim = (text: string): RecordedTurn => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });
const tool = (id: string, name: string, input: object): RecordedTurn => ({
  stop_reason: 'tool_use',
  content: [{ type: 'tool_use', id, name, input }],
});

/** Transcripts gravados para validar o pipeline do eval offline (não medem o modelo). */
const REPLAY: Record<string, RecordedTurn[]> = {
  'atraso-rastreio': [
    tool('t1', 'rastrear_entrega', { numeroPedido: '1001' }),
    fim('Seu pedido 1001 (BR123456789) tinha previsão 2026-09-20 e está atrasado.'),
  ],
  'segunda-via-confirmada': [
    tool('t1', 'gerar_segunda_via', { numeroPedido: '2001' }),
    fim('Segunda via emitida: vence em 01/10/2026, valor R$ 349,90.'),
  ],
  'prazo-inexistente': [fim('O estorno cai em 5 dias úteis, até 03/10.')], // alucinação plantada
  'falhas-seguidas': [
    tool('a', 'buscar_pedido', { numeroPedido: '5555' }),
    fim('Não encontrei o pedido 5555.'),
    tool('b', 'buscar_pedido', { numeroPedido: '6666' }),
    fim('Também não encontrei.'),
    tool('c', 'buscar_pedido', { numeroPedido: '7777' }),
  ],
};

describe('eval (modo replay)', () => {
  const casos = carregarCasos();

  it('conjunto de conversas é válido e cobre os cenários plantados', () => {
    expect(casos.length).toBeGreaterThanOrEqual(15);
    expect(new Set(casos.map((c) => c.id)).size).toBe(casos.length);
    for (const c of casos) {
      expect(c.turnos.length).toBeGreaterThan(0);
      expect(c.cpf).toMatch(/^\d{11}$/);
    }
    const pedidos = casos.flatMap((c) => c.turnos.join(' ').match(/\b\d{4}\b/g) ?? []);
    for (const p of ['1001', '1002', '2001', '2002', '3001', '3002']) expect(pedidos).toContain(p);
  });

  it('roda os casos, aplica confirmação, mede tool/alucinação/escalada e gera relatório', async () => {
    const selecionados = casos.filter((c) => c.id in REPLAY);
    const { resultados, resumo } = await rodarEval(selecionados, (c: Caso) => new ScriptedLlm(REPLAY[c.id]!));
    const por = Object.fromEntries(resultados.map((r) => [r.id, r]));

    expect(por['atraso-rastreio']).toMatchObject({ aprovado: true, alucinadas: [] });
    expect(por['segunda-via-confirmada']).toMatchObject({ aprovado: true, toolCorreta: true });
    expect(por['prazo-inexistente']!.alucinadas).toEqual(expect.arrayContaining(['data:10-03']));
    expect(por['prazo-inexistente']!.aprovado).toBe(false);
    expect(por['falhas-seguidas']).toMatchObject({ escaladaCorreta: true });
    expect(resumo.casos).toBe(4);
    expect(resumo.custoTotalCents).toBeGreaterThan(0);

    const md = relatorioMarkdown(resumo, resultados, { modelo: 'replay', data: '2026-09-28' });
    expect(md).toContain('| Acerto de tool |');
    expect(md).toContain('❌ data:10-03');
  });

  it('erro durante o caso reprova sem derrubar o eval', async () => {
    const caso = casos.find((c) => c.id === 'entregue-status')!;
    const { resultados } = await rodarEval([caso], () => new ScriptedLlm([]));
    expect(resultados[0]).toMatchObject({ aprovado: false, erro: expect.stringContaining('esgotado') });
    expect(relatorioMarkdown({} as any, resultados, { modelo: 'x', data: 'y' })).toContain('erro:');
  });
});
