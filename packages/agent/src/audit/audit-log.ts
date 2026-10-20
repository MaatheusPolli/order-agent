import type { AuditEntry, AuditLog } from './types.js';

export class InMemoryAuditLog implements AuditLog {
  private readonly entries: AuditEntry[] = [];

  async append(entry: AuditEntry): Promise<void> {
    this.entries.push(Object.freeze(structuredClone(entry)));
  }

  async byConversation(conversationId: string): Promise<AuditEntry[]> {
    return this.entries.filter((e) => e.conversationId === conversationId);
  }
}

/** Qualquer cliente com `query(sql, params)` — compatível com `pg.Pool`. */
export interface SqlClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

/**
 * Tabela imutável: o trigger rejeita UPDATE/DELETE, então nem um bug nem um
 * operador descuidado reescreve a história. (conversation_id, seq) é único.
 */
export const AUDIT_MIGRATION = `
CREATE TABLE IF NOT EXISTS audit_log (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id TEXT        NOT NULL,
  seq             INTEGER     NOT NULL,
  at              TIMESTAMPTZ NOT NULL,
  cpf             TEXT        NOT NULL,
  type            TEXT        NOT NULL,
  event           JSONB       NOT NULL,
  UNIQUE (conversation_id, seq)
);
CREATE INDEX IF NOT EXISTS audit_log_type_idx ON audit_log (type);

CREATE OR REPLACE FUNCTION audit_log_imutavel() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log é append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_imutavel();
`;

export class PostgresAuditLog implements AuditLog {
  constructor(private readonly db: SqlClient) {}

  async migrate(): Promise<void> {
    await this.db.query(AUDIT_MIGRATION);
  }

  async append(e: AuditEntry): Promise<void> {
    await this.db.query(
      'INSERT INTO audit_log (conversation_id, seq, at, cpf, type, event) VALUES ($1, $2, $3, $4, $5, $6)',
      [e.conversationId, e.seq, e.at, e.cpf, e.event.type, JSON.stringify(e.event)],
    );
  }

  async byConversation(conversationId: string): Promise<AuditEntry[]> {
    const { rows } = await this.db.query(
      'SELECT conversation_id, seq, at, cpf, event FROM audit_log WHERE conversation_id = $1 ORDER BY seq',
      [conversationId],
    );
    return rows.map((r) => ({
      conversationId: r.conversation_id,
      seq: r.seq,
      at: r.at instanceof Date ? r.at.toISOString() : r.at,
      cpf: r.cpf,
      event: r.event,
    }));
  }
}
