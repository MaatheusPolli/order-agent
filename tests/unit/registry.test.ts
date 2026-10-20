import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ALL_TOOLS, createDefaultRegistry, ToolRegistry } from '../../packages/agent/src/tools/registry.js';
import { defineTool, ToolError } from '../../packages/agent/src/tools/types.js';
import { CPF_ANA, ctxPara } from '../helpers/erp.js';

const fake = (name: string) =>
  defineTool({ name, description: 'x', schema: z.object({}), policy: 'read', handler: async () => 'ok' });

describe('ToolRegistry', () => {
  it('registra as 7 tools do planejamento', () => {
    expect(createDefaultRegistry().list().map((t) => t.name).sort()).toEqual([
      'abrir_chamado',
      'buscar_pedido',
      'consultar_politica_troca',
      'gerar_segunda_via',
      'listar_pedidos_cliente',
      'rastrear_entrega',
      'solicitar_cancelamento',
    ]);
  });

  it('falha no boot com nome duplicado ou inválido', () => {
    expect(() => new ToolRegistry([fake('a'), fake('a')])).toThrow(/duplicada/);
    expect(() => new ToolRegistry([fake('Nome Ruim')])).toThrow(/inválido/);
  });

  it('definitions batem com os schemas Zod', () => {
    const defs = createDefaultRegistry().definitions();
    const buscar = defs.find((d) => d.name === 'buscar_pedido')!;
    expect(buscar.input_schema).toMatchObject({
      type: 'object',
      required: ['numeroPedido'],
      properties: { numeroPedido: { type: 'string', pattern: '^\\d{3,10}$' } },
    });
    expect(buscar.input_schema).not.toHaveProperty('$schema');
    const chamado = defs.find((d) => d.name === 'abrir_chamado')!;
    expect(chamado.input_schema).toMatchObject({ required: ['motivo', 'descricao'] });
    expect((chamado.input_schema.properties as any).motivo.enum).toContain('atraso');
  });

  it('toda tool de efeito tem resumo para a confirmação e toda descrição diz quando não usar', () => {
    for (const t of ALL_TOOLS) {
      expect(t.description).toMatch(/Não (use|invente|prometa)/);
      if (t.policy === 'effect') expect(t.summarize).toBeTypeOf('function');
    }
    const effects = ALL_TOOLS.filter((t) => t.policy === 'effect').map((t) => t.name).sort();
    expect(effects).toEqual(['abrir_chamado', 'gerar_segunda_via', 'solicitar_cancelamento']);
  });

  it('parse rejeita tool desconhecida e argumentos inválidos com ToolError', () => {
    const reg = createDefaultRegistry();
    expect(() => reg.parse('apagar_tudo', {})).toThrow(ToolError);
    try {
      reg.parse('buscar_pedido', { numeroPedido: 'abc; drop table' });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ToolError);
      expect((e as ToolError).codigo).toBe('argumentos_invalidos');
      expect((e as ToolError).message).toContain('numeroPedido');
    }
    expect(() => reg.parse('listar_pedidos_cliente', undefined)).not.toThrow();
  });

  it('execute valida e chama o handler', async () => {
    const reg = createDefaultRegistry();
    const r = (await reg.execute('buscar_pedido', { numeroPedido: '1001' }, ctxPara(CPF_ANA))) as any;
    expect(r.status).toBe('em_transporte');
  });

  it('resumos das tools de efeito', () => {
    const reg = createDefaultRegistry();
    expect(reg.get('solicitar_cancelamento')!.summarize!({ numeroPedido: '3001' })).toContain('não pode ser desfeita');
    expect(reg.get('gerar_segunda_via')!.summarize!({ numeroPedido: '2001' })).toContain('2001');
    expect(reg.get('abrir_chamado')!.summarize!({ motivo: 'atraso', descricao: '' })).not.toContain('pedido');
    expect(reg.get('abrir_chamado')!.summarize!({ motivo: 'atraso', numeroPedido: '1001', descricao: '' })).toContain(
      '1001',
    );
  });
});
