import { describe, expect, it } from 'vitest';
import { Authorizer } from '../../packages/agent/src/policy/authorizer.js';
import { createDefaultRegistry } from '../../packages/agent/src/tools/registry.js';
import { defineTool } from '../../packages/agent/src/tools/types.js';
import { z } from 'zod';
import { CPF_ANA, ctxPara } from '../helpers/erp.js';

const reg = createDefaultRegistry();
const auth = new Authorizer();

describe('Authorizer', () => {
  it('leitura executa livremente', () => {
    expect(auth.decide(reg.get('buscar_pedido')!, { numeroPedido: '1001' }, ctxPara(CPF_ANA))).toEqual({
      kind: 'allow',
    });
  });

  it.each(['gerar_segunda_via', 'abrir_chamado', 'solicitar_cancelamento'])(
    '%s (efeito) exige confirmação com resumo',
    (nome) => {
      const d = auth.decide(reg.get(nome)!, { numeroPedido: '1001', motivo: 'atraso', descricao: 'x' }, ctxPara(CPF_ANA));
      expect(d.kind).toBe('confirm');
      expect(d.kind === 'confirm' && d.summary).toContain('1001');
    },
  );

  it('efeito sem summarize usa resumo genérico', () => {
    const t = defineTool({ name: 'x', description: '', schema: z.object({}), policy: 'effect', handler: async () => 1 });
    expect(auth.decide(t, {}, ctxPara(CPF_ANA))).toEqual({ kind: 'confirm', summary: 'Executar x.' });
  });

  it('sem cliente autenticado nega até leitura', () => {
    const d = auth.decide(reg.get('listar_pedidos_cliente')!, {}, { ...ctxPara(CPF_ANA), cpf: '' });
    expect(d).toMatchObject({ kind: 'deny', codigo: 'nao_autenticado' });
  });
});
