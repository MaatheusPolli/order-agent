const BASE = '/api';

export interface Confirmacao {
  id: string;
  name: string;
  input: unknown;
  summary: string;
}

export interface TimelineItem {
  id: string;
  name: string;
  input: unknown;
  status: 'executando' | 'ok' | 'erro' | 'aguardando' | 'aprovada' | 'recusada' | 'negada';
  output?: unknown;
  latencyMs?: number;
}

export interface AuditEntry {
  seq: number;
  at: string;
  event: { type: string; [k: string]: unknown };
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json();
  if (!res.ok) throw new Error(body.mensagem ?? body.erro ?? `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  async entrar(cpf: string, numeroPedido: string) {
    const res = await fetch(`${BASE}/sessao`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cpf, numeroPedido }),
    });
    return (await json<{ token: string }>(res)).token;
  },

  async novaConversa(token: string) {
    const res = await fetch(`${BASE}/conversas`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    return (await json<{ id: string }>(res)).id;
  },

  async painel(token: string, id: string) {
    const res = await fetch(`${BASE}/conversas/${id}`, { headers: { authorization: `Bearer ${token}` } });
    return json<{ custoCents: number; pendente: boolean; auditoria: AuditEntry[] }>(res);
  },

  mensagensUrl: (id: string) => `${BASE}/conversas/${id}/mensagens`,
  confirmacoesUrl: (id: string) => `${BASE}/conversas/${id}/confirmacoes`,
};
