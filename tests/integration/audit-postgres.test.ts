import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { describe, expect, it, afterAll } from 'vitest';
import { PostgresAuditLog } from '../../packages/agent/src/audit/audit-log.js';
import type { AuditEntry } from '../../packages/agent/src/audit/types.js';

// `pg` é dependência de apps/api; resolve a partir de lá (pnpm não hoista para a raiz).
const require = createRequire(path.resolve(__dirname, '../../apps/api/package.json'));
const { Pool } = require('pg') as typeof import('pg');

const url = process.env.DATABASE_URL;

// Roda só com DATABASE_URL (CI sobe um service container de Postgres).
describe.skipIf(!url)('PostgresAuditLog com Postgres real', () => {
  const pool = url ? new Pool({ connectionString: url }) : undefined!;
  const log = new PostgresAuditLog(pool);
  const conversationId = randomUUID();

  const entrada = (seq: number): AuditEntry => ({
    conversationId,
    seq,
    at: new Date(Date.UTC(2026, 9, 26, 12, 0, seq)).toISOString(),
    cpf: '11111111111',
    event: { type: 'user_message', text: `mensagem ${seq}` } as AuditEntry['event'],
  });

  afterAll(async () => {
    await pool.end();
  });

  it('migração é idempotente', async () => {
    await log.migrate();
    await expect(log.migrate()).resolves.toBeUndefined();
  });

  it('grava e lê em ordem de seq', async () => {
    await log.append(entrada(2));
    await log.append(entrada(1));
    const lidas = await log.byConversation(conversationId);
    expect(lidas.map((e) => e.seq)).toEqual([1, 2]);
    expect(lidas[0].event).toMatchObject({ type: 'user_message', text: 'mensagem 1' });
  });

  it('rejeita seq duplicado na mesma conversa', async () => {
    await expect(log.append(entrada(1))).rejects.toThrow();
  });

  it('trigger bloqueia UPDATE e DELETE', async () => {
    await expect(
      pool.query('UPDATE audit_log SET cpf = $1 WHERE conversation_id = $2', ['00000000000', conversationId]),
    ).rejects.toThrow(/append-only/);
    await expect(pool.query('DELETE FROM audit_log WHERE conversation_id = $1', [conversationId])).rejects.toThrow(
      /append-only/,
    );
    const lidas = await log.byConversation(conversationId);
    expect(lidas).toHaveLength(2);
  });
});
