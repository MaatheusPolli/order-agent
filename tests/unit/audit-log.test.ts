import { describe, expect, it } from 'vitest';
import {
  AUDIT_MIGRATION,
  InMemoryAuditLog,
  PostgresAuditLog,
  type SqlClient,
} from '../../packages/agent/src/audit/audit-log.js';
import type { AuditEntry } from '../../packages/agent/src/audit/types.js';

const entry = (conversationId: string, seq: number): AuditEntry => ({
  conversationId,
  seq,
  at: '2026-09-28T12:00:00.000Z',
  cpf: '11111111111',
  event: { type: 'user_message', text: `msg ${seq}` },
});

describe('InMemoryAuditLog', () => {
  it('filtra por conversa e entradas são imutáveis', async () => {
    const log = new InMemoryAuditLog();
    const e = entry('c1', 1);
    await log.append(e);
    await log.append(entry('c2', 1));
    e.cpf = 'alterado depois';
    const [gravada] = await log.byConversation('c1');
    expect(gravada!.cpf).toBe('11111111111');
    expect(() => {
      (gravada as any).cpf = 'x';
    }).toThrow();
  });
});

describe('PostgresAuditLog', () => {
  function fakeDb(rows: any[] = []) {
    const calls: { sql: string; params?: unknown[] }[] = [];
    const db: SqlClient = {
      async query(sql, params) {
        calls.push({ sql, params });
        return { rows };
      },
    };
    return { db, calls };
  }

  it('migração cria tabela com trigger append-only', async () => {
    const { db, calls } = fakeDb();
    await new PostgresAuditLog(db).migrate();
    expect(calls[0]!.sql).toBe(AUDIT_MIGRATION);
    expect(AUDIT_MIGRATION).toMatch(/BEFORE UPDATE OR DELETE ON audit_log/);
    expect(AUDIT_MIGRATION).toMatch(/UNIQUE \(conversation_id, seq\)/);
  });

  it('append usa INSERT parametrizado (sem UPDATE/DELETE em lugar nenhum)', async () => {
    const { db, calls } = fakeDb();
    await new PostgresAuditLog(db).append(entry('c1', 1));
    expect(calls[0]!.sql).toMatch(/^INSERT INTO audit_log/);
    expect(calls[0]!.params).toEqual([
      'c1',
      1,
      '2026-09-28T12:00:00.000Z',
      '11111111111',
      'user_message',
      JSON.stringify({ type: 'user_message', text: 'msg 1' }),
    ]);
  });

  it('byConversation ordena por seq e normaliza datas', async () => {
    const { db, calls } = fakeDb([
      { conversation_id: 'c1', seq: 1, at: new Date('2026-09-28T12:00:00Z'), cpf: '1', event: { type: 'x' } },
      { conversation_id: 'c1', seq: 2, at: '2026-09-28T12:00:01.000Z', cpf: '1', event: { type: 'y' } },
    ]);
    const r = await new PostgresAuditLog(db).byConversation('c1');
    expect(calls[0]!.sql).toMatch(/ORDER BY seq/);
    expect(r.map((e) => e.at)).toEqual(['2026-09-28T12:00:00.000Z', '2026-09-28T12:00:01.000Z']);
  });
});
