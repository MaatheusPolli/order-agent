export interface SseEvent {
  event: string;
  data: any;
}

/**
 * Parser incremental de SSE: recebe pedaços de texto e devolve os eventos
 * completos, guardando o resto para o próximo pedaço.
 */
export class SseParser {
  private buffer = '';

  push(chunk: string): SseEvent[] {
    this.buffer += chunk.replace(/\r\n/g, '\n');
    const blocos = this.buffer.split('\n\n');
    this.buffer = blocos.pop() ?? '';
    const out: SseEvent[] = [];
    for (const bloco of blocos) {
      let event = 'message';
      const dados: string[] = [];
      for (const linha of bloco.split('\n')) {
        if (linha.startsWith('event:')) event = linha.slice(6).trim();
        else if (linha.startsWith('data:')) dados.push(linha.slice(5).trimStart());
      }
      if (dados.length === 0) continue;
      try {
        out.push({ event, data: JSON.parse(dados.join('\n')) });
      } catch {
        out.push({ event, data: dados.join('\n') });
      }
    }
    return out;
  }
}

/** POST que responde em SSE (EventSource só faz GET). */
export async function postSse(
  url: string,
  body: unknown,
  token: string,
  onEvent: (e: SseEvent) => void,
): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const erro = await res.json().catch(() => ({}));
    throw new Error(erro.erro ?? `HTTP ${res.status}`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  const parser = new SseParser();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const e of parser.push(value)) onEvent(e);
  }
}
