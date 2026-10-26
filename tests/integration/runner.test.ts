import { describe, expect, it } from 'vitest';
import {
  AgentRunner,
  MENSAGENS_PARADA,
  newConversation,
  type AgentEvent,
} from '../../packages/agent/src/runner.js';
import { createDefaultRegistry, ToolRegistry } from '../../packages/agent/src/tools/registry.js';
import { defineTool } from '../../packages/agent/src/tools/types.js';
import { SYSTEM_PROMPT } from '../../packages/agent/src/prompts/system.js';
import { z } from 'zod';
import { CPF_ANA, ctxPara } from '../helpers/erp.js';
import { ScriptedLlm, type RecordedTurn } from '../helpers/scripted-llm.js';

const registry = createDefaultRegistry();

function coletar() {
  const eventos: AgentEvent[] = [];
  return { eventos, onEvent: (e: AgentEvent) => eventos.push(e) };
}

describe('AgentRunner', () => {
  it('executa o loop tool_use → tool_result → resposta final com streaming', async () => {
    const llm = ScriptedLlm.fromFixture('pedido-atrasado');
    const runner = new AgentRunner({ llm, registry });
    const conv = newConversation();
    const { eventos, onEvent } = coletar();

    const r = await runner.run(conv, 'Cadê meu pedido 1001?', ctxPara(CPF_ANA), onEvent);

    expect(r).toMatchObject({ reason: 'resposta_final', iterations: 2 });
    expect(r.text).toContain('BR123456789');

    // streaming: texto chega em vários deltas
    const deltas = eventos.filter((e) => e.type === 'text');
    expect(deltas.length).toBeGreaterThan(3);

    const result = eventos.find((e) => e.type === 'tool_result');
    expect(result).toMatchObject({ name: 'rastrear_entrega', ok: true, output: { atrasado: true } });

    // o 2º request carrega o tool_result com o dado real do ERP
    const segundo = llm.requests[1]!;
    const ultima = segundo.messages.at(-1)!;
    expect(ultima.role).toBe('user');
    expect(JSON.stringify(ultima.content)).toContain('toolu_01');
    expect(JSON.stringify(ultima.content)).toContain('2026-09-20');

    // prompt estável separado do contexto volátil (cache), definitions das tools enviadas
    expect(segundo.system).toBe(SYSTEM_PROMPT);
    expect(segundo.systemVolatile).toContain('2026-09-28');
    expect(segundo.tools).toHaveLength(7);

    // histórico: user, assistant(tool_use), user(tool_result), assistant(final)
    expect(conv.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(conv.costCents).toBeGreaterThan(0);
    expect(eventos.at(-1)).toMatchObject({ type: 'done', reason: 'resposta_final' });
  });

  it('tools paralelas voltam numa única mensagem; erros viram is_error sem derrubar o loop', async () => {
    const llm = ScriptedLlm.fromFixture('tools-paralelas-com-erro');
    const runner = new AgentRunner({ llm, registry });
    const conv = newConversation();

    const r = await runner.run(conv, 'Meus pedidos 1002, 2001 e x', ctxPara(CPF_ANA));

    expect(r.reason).toBe('resposta_final');
    const toolResults = conv.messages[2]!.content as { tool_use_id: string; is_error?: boolean; content: string }[];
    expect(toolResults.map((t) => t.tool_use_id)).toEqual(['toolu_a', 'toolu_b', 'toolu_c']);
    expect(toolResults[0]!.is_error).toBeUndefined();
    // pedido de outro cliente: negado como inexistente
    expect(toolResults[1]).toMatchObject({ is_error: true });
    expect(toolResults[1]!.content).toContain('pedido_nao_encontrado');
    // argumento inválido
    expect(toolResults[2]!.content).toContain('argumentos_invalidos');
  });

  it('erro inesperado de handler não vaza detalhes ao LLM', async () => {
    const quebrada = defineTool({
      name: 'quebrada',
      description: 'x',
      schema: z.object({}),
      policy: 'read',
      handler: async () => {
        throw new Error('segredo interno: senha=123');
      },
    });
    const llm = new ScriptedLlm([
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'quebrada', input: {} }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] },
    ]);
    const conv = newConversation();
    await new AgentRunner({ llm, registry: new ToolRegistry([quebrada]) }).run(conv, 'oi', ctxPara(CPF_ANA));
    const serializado = JSON.stringify(conv.messages[2]);
    expect(serializado).toContain('falha_interna');
    expect(serializado).not.toContain('senha');
  });

  it('para em maxIterations com mensagem adequada e histórico válido', async () => {
    const loopInfinito: RecordedTurn[] = Array.from({ length: 10 }, (_, i) => ({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: `t${i}`, name: 'listar_pedidos_cliente', input: {} }],
    }));
    const llm = new ScriptedLlm(loopInfinito);
    const runner = new AgentRunner({ llm, registry, limits: { maxIterations: 3, maxCostCents: 1000, maxFalhas: 3 } });
    const conv = newConversation();

    const r = await runner.run(conv, 'oi', ctxPara(CPF_ANA));

    expect(r).toMatchObject({ reason: 'limite_iteracoes', iterations: 3 });
    expect(r.text).toBe(MENSAGENS_PARADA.limite_iteracoes);
    expect(llm.requests).toHaveLength(3);
    // termina com assistant de texto depois dos tool_results → conversa pode continuar
    expect(conv.messages.at(-1)).toEqual({ role: 'assistant', content: MENSAGENS_PARADA.limite_iteracoes });
    expect(conv.messages.at(-2)!.role).toBe('user');
  });

  it('custo acumulado interrompe a conversa', async () => {
    const caro: RecordedTurn = {
      stop_reason: 'tool_use',
      usage: { input_tokens: 100_000, output_tokens: 0 }, // 50 centavos
      content: [{ type: 'tool_use', id: 't1', name: 'listar_pedidos_cliente', input: {} }],
    };
    const llm = new ScriptedLlm([caro, caro]);
    const runner = new AgentRunner({ llm, registry, limits: { maxIterations: 8, maxCostCents: 40, maxFalhas: 3 } });
    const conv = newConversation();
    const { eventos, onEvent } = coletar();

    const r = await runner.run(conv, 'oi', ctxPara(CPF_ANA), onEvent);

    expect(r.reason).toBe('limite_custo');
    expect(llm.requests).toHaveLength(1);
    expect(eventos.find((e) => e.type === 'llm_usage')).toMatchObject({ costCents: 50 });

    // próxima mensagem na mesma conversa já é barrada sem chamar o LLM
    const r2 = await runner.run(conv, 'e agora?', ctxPara(CPF_ANA));
    expect(r2).toMatchObject({ reason: 'limite_custo', iterations: 0 });
    expect(llm.requests).toHaveLength(1);
  });

  it('stop_reason refusal encerra com mensagem segura', async () => {
    const llm = new ScriptedLlm([{ stop_reason: 'refusal', content: [] }]);
    const conv = newConversation();
    const r = await new AgentRunner({ llm, registry }).run(conv, '...', ctxPara(CPF_ANA));
    expect(r).toMatchObject({ reason: 'recusa', text: MENSAGENS_PARADA.recusa });
    expect(conv.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('multi-turno reaproveita o histórico', async () => {
    const llm = new ScriptedLlm([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Olá! Como posso ajudar?' }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Claro.' }] },
    ]);
    const runner = new AgentRunner({ llm, registry });
    const conv = newConversation();
    await runner.run(conv, 'oi', ctxPara(CPF_ANA));
    await runner.run(conv, 'tudo bem?', ctxPara(CPF_ANA));
    expect(llm.requests[1]!.messages).toHaveLength(3);
  });

  it('RF06: listar pedidos com sucesso não zera o contador de falhas', async () => {
    const busca = (id: string, numero: string): RecordedTurn => ({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id, name: 'buscar_pedido', input: { numeroPedido: numero } }],
    });
    const lista = (id: string): RecordedTurn => ({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id, name: 'listar_pedidos_cliente', input: {} }],
    });
    const llm = new ScriptedLlm([
      busca('a', '9001'),
      lista('l1'),
      busca('b', '9002'),
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'nunca chega aqui' }] },
    ]);
    const runner = new AgentRunner({ llm, registry, limits: { maxIterations: 20, maxCostCents: 1000, maxFalhas: 2 } });
    const r = await runner.run(newConversation(), 'cadê meus pedidos 9001 e 9002?', ctxPara(CPF_ANA));
    expect(r.reason).toBe('escalada');
    expect(llm.requests).toHaveLength(3);
  });

  it('RF06: escala após N falhas de entendimento seguidas; sucesso zera o contador', async () => {
    const busca = (id: string, numero: string): RecordedTurn => ({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id, name: 'buscar_pedido', input: { numeroPedido: numero } }],
    });
    const llm = new ScriptedLlm([
      busca('a', '9001'),
      busca('b', '9002'),
      busca('ok', '1001'), // acerto zera
      busca('c', '9003'),
      busca('d', '9004'),
      busca('e', '9005'),
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'nunca chega aqui' }] },
    ]);
    const runner = new AgentRunner({ llm, registry, limits: { maxIterations: 20, maxCostCents: 1000, maxFalhas: 3 } });
    const conv = newConversation();
    const r = await runner.run(conv, 'cadê meus pedidos?', ctxPara(CPF_ANA));
    expect(r.reason).toBe('escalada');
    expect(r.text).toContain('equipe humana');
    expect(llm.requests).toHaveLength(6);
    expect(conv.messages.at(-1)!.role).toBe('assistant');
  });

  it('RF06: erro de negócio legítimo (ex.: boleto já pago) não conta como falha', async () => {
    const llm = new ScriptedLlm([
      ...Array.from({ length: 3 }, (_, i): RecordedTurn => ({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: `r${i}`, name: 'rastrear_entrega', input: { numeroPedido: '3001' } }],
      })),
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Ainda sem rastreio.' }] },
    ]);
    const r = await new AgentRunner({ llm, registry }).run(newConversation(), 'rastreio?', ctxPara('33333333333'));
    expect(r.reason).toBe('resposta_final');
  });
});
