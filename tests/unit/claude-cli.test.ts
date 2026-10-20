import { describe, expect, it } from 'vitest';
import { ClaudeCliLlm, extrairJson, mensagemDoCli, serializarMensagens } from '../../packages/agent/src/ports/claude-cli.js';

const tools = [{ name: 'buscar_pedido', description: 'x', input_schema: { type: 'object' } }];

describe('extrairJson', () => {
  it('lê JSON puro e com cerca markdown', () => {
    expect(extrairJson('{"text":"oi","tool_calls":[]}')).toEqual({ text: 'oi', tool_calls: [] });
    expect(extrairJson('```json\n{"text":"ok"}\n```')).toEqual({ text: 'ok' });
  });

  it('devolve null quando não há JSON', () => {
    expect(extrairJson('sem json aqui')).toBeNull();
    expect(extrairJson('{quebrado')).toBeNull();
  });
});

describe('mensagemDoCli', () => {
  it('converte tool_calls em blocos tool_use e stop_reason tool_use', () => {
    const msg = mensagemDoCli(
      { result: '{"text":"","tool_calls":[{"name":"buscar_pedido","input":{"numero":1001}}]}', usage: { input_tokens: 3, output_tokens: 4 } },
      'claude-opus-5',
    );
    expect(msg.stop_reason).toBe('tool_use');
    expect(msg.content).toEqual([
      expect.objectContaining({ type: 'tool_use', name: 'buscar_pedido', input: { numero: 1001 } }),
    ]);
    expect(msg.usage.output_tokens).toBe(4);
  });

  it('texto sem JSON vira resposta final, sem tool_use', () => {
    const msg = mensagemDoCli({ result: 'Seu pedido chegou.' }, 'claude-opus-5');
    expect(msg.stop_reason).toBe('end_turn');
    expect(msg.content).toEqual([expect.objectContaining({ type: 'text', text: 'Seu pedido chegou.' })]);
  });
});

describe('serializarMensagens', () => {
  it('representa tool_use e tool_result no prompt', () => {
    const texto = serializarMensagens([
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'buscar_pedido', input: { numero: 1 } }] as never },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"ok":true}' }] as never },
    ]);
    expect(texto).toContain('[tool_use id=t1 name=buscar_pedido] {"numero":1}');
    expect(texto).toContain('[tool_result id=t1] {"ok":true}');
  });
});

describe('ClaudeCliLlm', () => {
  it('chama o CLI sem ferramentas, com o system prompt e o protocolo, e emite o texto', async () => {
    let args: string[] = [];
    let stdin = '';
    const llm = new ClaudeCliLlm({
      model: 'claude-opus-5',
      run: async (a, s) => {
        args = a;
        stdin = s;
        return JSON.stringify({ result: '{"text":"Olá","tool_calls":[]}', usage: { input_tokens: 1, output_tokens: 1 } });
      },
    });
    const deltas: string[] = [];
    const msg = await llm.stream(
      { system: 'SYS', systemVolatile: 'HOJE', tools, messages: [{ role: 'user', content: 'oi' }] },
      (d) => deltas.push(d),
    );

    expect(args).toContain('-p');
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(args[args.indexOf('--model') + 1]).toBe('claude-opus-5');
    expect(args[args.indexOf('--system-prompt') + 1]).toContain('SYS');
    expect(stdin).toContain('buscar_pedido');
    expect(stdin).toContain('[user]\noi');
    expect(deltas.join('')).toBe('Olá');
    expect(msg.stop_reason).toBe('end_turn');
  });

  it('erro reportado pelo CLI vira exceção', async () => {
    const llm = new ClaudeCliLlm({ run: async () => JSON.stringify({ is_error: true, result: 'limite' }) });
    await expect(llm.stream({ system: '', tools, messages: [] }, () => {})).rejects.toThrow('limite');
  });
});
