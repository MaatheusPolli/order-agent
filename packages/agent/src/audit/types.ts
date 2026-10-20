/** Tudo que acontece numa conversa, na ordem em que acontece (RF07). */
export type AuditEvent =
  | { type: 'user_message'; text: string }
  | { type: 'llm_usage'; model: string; usage: unknown; costCents: number }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; name: string; ok: boolean; output: unknown; latencyMs: number }
  | { type: 'confirmation_required'; id: string; name: string; input: unknown; summary: string }
  | { type: 'confirmation_resolved'; id: string; name: string; approved: boolean }
  | { type: 'tool_denied'; id: string; name: string; codigo: string }
  | { type: 'done'; reason: string; text: string };

export interface AuditEntry {
  conversationId: string;
  seq: number;
  at: string;
  cpf: string;
  event: AuditEvent;
}

/** Log append-only: não existe operação de alterar ou apagar. */
export interface AuditLog {
  append(entry: AuditEntry): Promise<void>;
  byConversation(conversationId: string): Promise<AuditEntry[]>;
}
