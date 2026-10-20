import pg from 'pg';
import {
  AgentRunner,
  llmFromEnv,
  createDefaultRegistry,
  HttpErpClient,
  InMemoryAuditLog,
  PostgresAuditLog,
  type AuditLog,
} from '@order-agent/agent';
import { buildApi } from './server.js';

const erp = new HttpErpClient(process.env.ERP_BASE_URL ?? 'http://localhost:4001');

let audit: AuditLog;
if (process.env.DATABASE_URL) {
  const pgAudit = new PostgresAuditLog(new pg.Pool({ connectionString: process.env.DATABASE_URL }));
  await pgAudit.migrate();
  audit = pgAudit;
} else {
  console.warn('DATABASE_URL não definida: auditoria em memória (perdida ao reiniciar).');
  audit = new InMemoryAuditLog();
}

// A data "hoje" vem do ERP (o mock usa data fixa para reprodutibilidade).
const { hoje } = (await (await fetch(`${process.env.ERP_BASE_URL ?? 'http://localhost:4001'}/health`)).json()) as {
  hoje: string;
};

const runner = new AgentRunner({ llm: llmFromEnv(), registry: createDefaultRegistry(), audit });
const port = Number(process.env.PORT ?? 3000);
await buildApi({ erp, runner, audit, hoje }).listen({ port, host: '0.0.0.0' });
console.log(`API ouvindo em :${port}`);
