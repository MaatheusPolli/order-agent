import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildErpServer, HOJE } from '../apps/erp-mock/src/server.js';
import {
  AgentRunner,
  llmFromEnv,
  createDefaultRegistry,
  HttpErpClient,
  newConversation,
  type AgentEvent,
  type LlmPort,
  type RunResult,
} from '../packages/agent/src/index.js';
import { avaliarCaso, resumir, type Esperado, type ResultadoCaso, type Resumo } from './metrics.js';

export interface Caso {
  id: string;
  cenario: string;
  cpf: string;
  turnos: string[];
  /** Decisão aplicada a toda confirmação pedida (padrão: recusar). */
  confirmar?: boolean;
  esperado: Esperado;
}

export interface ResultadoEval extends ResultadoCaso {
  id: string;
  cenario: string;
  custoCents: number;
  toolsChamadas: string[];
  respostas: string[];
  erro?: string;
}

export function carregarCasos(path = fileURLToPath(new URL('./conversas.jsonl', import.meta.url))): Caso[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Caso);
}

/** ERP mock isolado por caso, falando via `inject` (sem rede, estado limpo). */
function erpIsolado() {
  const server = buildErpServer();
  return new HttpErpClient('http://erp.eval', async (url, init) => {
    const res = await server.inject({
      method: (init?.method ?? 'GET') as 'GET' | 'POST',
      url: url.replace('http://erp.eval', ''),
      headers: init?.headers as Record<string, string> | undefined,
      payload: init?.body as string | undefined,
    });
    return new Response(res.body, { status: res.statusCode });
  });
}

export async function rodarCaso(caso: Caso, llm: LlmPort): Promise<ResultadoEval> {
  const ctx = { cpf: caso.cpf, hoje: HOJE, erp: erpIsolado() };
  const runner = new AgentRunner({ llm, registry: createDefaultRegistry() });
  const conv = newConversation(`eval-${caso.id}`);

  const toolsChamadas: string[] = [];
  const toolsExecutadas: string[] = [];
  const fontes: string[] = [];
  const motivosParada: string[] = [];
  const respostas: string[] = [];
  let custoCents = 0;

  const onEvent = (e: AgentEvent) => {
    if (e.type === 'tool_call') toolsChamadas.push(e.name);
    if (e.type === 'tool_result') {
      fontes.push(JSON.stringify(e.output));
      if (e.ok) toolsExecutadas.push(e.name);
    }
    if (e.type === 'llm_usage') custoCents += e.costCents;
    if (e.type === 'done') {
      motivosParada.push(e.reason);
      if (e.text) respostas.push(e.text);
    }
  };

  let erro: string | undefined;
  try {
    for (const turno of caso.turnos) {
      fontes.push(turno);
      let r: RunResult = await runner.run(conv, turno, ctx, onEvent);
      while (r.reason === 'aguardando_confirmacao') {
        const decisoes = Object.fromEntries(r.confirmations!.map((c) => [c.id, caso.confirmar === true]));
        r = await runner.resolve(conv, decisoes, ctx, onEvent);
      }
    }
  } catch (e) {
    erro = e instanceof Error ? e.message : String(e);
  }

  const avaliacao = avaliarCaso(caso.esperado, { toolsChamadas, toolsExecutadas, fontes, respostas, motivosParada });
  return {
    id: caso.id,
    cenario: caso.cenario,
    ...avaliacao,
    aprovado: avaliacao.aprovado && !erro,
    custoCents,
    toolsChamadas,
    respostas,
    erro,
  };
}

export async function rodarEval(casos: Caso[], llmPara: (caso: Caso) => LlmPort) {
  const resultados: ResultadoEval[] = [];
  for (const caso of casos) resultados.push(await rodarCaso(caso, llmPara(caso)));
  return { resultados, resumo: resumir(resultados) };
}

export function relatorioMarkdown(
  resumo: Resumo,
  resultados: ResultadoEval[],
  meta: { modelo: string; data: string },
): string {
  const sim = (b: boolean | null) => (b === null ? '—' : b ? '✅' : '❌');
  const linhas = resultados.map(
    (r) =>
      `| ${r.id} | ${r.cenario} | ${r.toolsChamadas.join(', ') || '—'} | ${sim(r.toolCorreta)} | ${
        r.alucinadas.length ? `❌ ${r.alucinadas.join(', ')}` : '✅'
      } | ${sim(r.escaladaCorreta)} | ${sim(r.conteudoOk)} | ${r.erro ? `erro: ${r.erro}` : sim(r.aprovado)} |`,
  );
  return `# Relatório de avaliação — OrderAgent

- Modelo: \`${meta.modelo}\`
- Executado em: ${meta.data}
- Data de referência do ERP mock: ${HOJE}

## Resumo

| Métrica | Valor |
|---|---|
| Casos aprovados | ${resumo.aprovados}/${resumo.casos} |
| Acerto de tool | ${resumo.acertoTool}% |
| Taxa de alucinação (casos com ≥1 entidade sem fonte) | ${resumo.taxaAlucinacao}% |
| Entidades verificadas / sem fonte | ${resumo.entidadesVerificadas} / ${resumo.entidadesAlucinadas} |
| Escalada correta | ${resumo.acertoEscalada === null ? '—' : `${resumo.acertoEscalada}%`} |
| Custo total | ${resumo.custoTotalCents} ¢ (US$) |

## Casos

| Caso | Cenário | Tools chamadas | Tool certa | Alucinação | Escalada | Conteúdo | Aprovado |
|---|---|---|---|---|---|---|---|
${linhas.join('\n')}

## Metodologia

- Cada caso roda com um ERP mock novo (seed fixa) e o cliente autenticado do caso; confirmações são aprovadas ou recusadas conforme \`confirmar\`.
- **Acerto de tool**: todas as tools esperadas foram chamadas e nenhuma proibida.
- **Alucinação**: datas, valores, códigos de rastreio, protocolos, números de pedido e prazos em dias citados na resposta precisam aparecer (normalizados) em algum resultado de tool ou mensagem do cliente.
- **Escalada**: houve chamado aberto ou parada \`escalada\` quando esperado (e não houve quando não esperado).
`;
}

async function main() {
  if (!process.argv.includes('--live')) {
    console.error('Uso: pnpm eval --live   (LLM_PROVIDER=claude-cli usa o Claude Code local; padrão: API, requer ANTHROPIC_API_KEY)');
    process.exit(1);
  }
  const casos = carregarCasos();
  const llm = llmFromEnv();
  const { resultados, resumo } = await rodarEval(casos, () => llm);
  const md = relatorioMarkdown(resumo, resultados, { modelo: llm.model, data: new Date().toISOString() });
  const destino = fileURLToPath(new URL('../report/eval.md', import.meta.url));
  mkdirSync(fileURLToPath(new URL('../report/', import.meta.url)), { recursive: true });
  writeFileSync(destino, md);
  writeFileSync(destino.replace(/\.md$/, '.json'), JSON.stringify({ resumo, resultados }, null, 2));
  console.log(md);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
