import { describe, expect, it } from 'vitest';
import { SseParser } from '../../apps/web/src/lib/sse.js';
import { formatarCpf, formatarCusto, nomeTool } from '../../apps/web/src/lib/format.js';

describe('SseParser', () => {
  it('junta eventos quebrados entre chunks', () => {
    const p = new SseParser();
    expect(p.push('event: text\ndata: {"delta":"Ol')).toEqual([]);
    expect(p.push('á"}\n\nevent: end\r\ndata: {"reason":"resposta_final"}\r\n\r\n')).toEqual([
      { event: 'text', data: { delta: 'Olá' } },
      { event: 'end', data: { reason: 'resposta_final' } },
    ]);
  });

  it('evento sem nome vira message; dado não-JSON vira string; bloco sem data é ignorado', () => {
    const p = new SseParser();
    expect(p.push(': ping\n\ndata: oi\n\n')).toEqual([{ event: 'message', data: 'oi' }]);
  });
});

describe('format', () => {
  it('cpf, custo e nome de tool', () => {
    expect(formatarCpf('11111111111')).toBe('111.111.111-11');
    expect(formatarCpf('1234')).toBe('123.4');
    expect(formatarCusto(1.5)).toBe('US$ 0,0150');
    expect(nomeTool('rastrear_entrega')).toBe('Rastrear entrega');
    expect(nomeTool('outra')).toBe('outra');
  });
});
