import { buildErpServer, HOJE } from '../../apps/erp-mock/src/server.js';
import { HttpErpClient } from '../../packages/agent/src/ports/erp.js';
import type { AgentContext } from '../../packages/agent/src/tools/types.js';

/** HttpErpClient real, falando com uma instância isolada do ERP mock via `inject` (sem rede). */
export function createTestErp() {
  const server = buildErpServer();
  const fetchFn = async (url: string, init?: RequestInit) => {
    const res = await server.inject({
      method: (init?.method ?? 'GET') as 'GET' | 'POST',
      url: url.replace('http://erp.test', ''),
      headers: init?.headers as Record<string, string> | undefined,
      payload: init?.body as string | undefined,
    });
    return new Response(res.body, { status: res.statusCode, headers: { 'content-type': 'application/json' } });
  };
  return new HttpErpClient('http://erp.test', fetchFn);
}

export const CPF_ANA = '11111111111';
export const CPF_BRUNO = '22222222222';
export const CPF_CARLA = '33333333333';

export function ctxPara(cpf: string): AgentContext {
  return { cpf, hoje: HOJE, erp: createTestErp() };
}
