import { useState } from 'react';
import type { AuditEntry, TimelineItem } from '../lib/api';
import { formatarCusto, nomeTool } from '../lib/format';

const COR: Record<TimelineItem['status'], string> = {
  executando: 'bg-slate-200 text-slate-700',
  ok: 'bg-emerald-100 text-emerald-800',
  erro: 'bg-red-100 text-red-800',
  aguardando: 'bg-amber-100 text-amber-800',
  aprovada: 'bg-emerald-100 text-emerald-800',
  recusada: 'bg-slate-200 text-slate-700',
  negada: 'bg-red-100 text-red-800',
};

interface Props {
  itens: TimelineItem[];
  auditoria: AuditEntry[] | null;
  onCarregarAuditoria: () => void;
}

/** RF09: timeline das tool calls da conversa + trilha de auditoria completa. */
export function ToolTimeline({ itens, auditoria, onCarregarAuditoria }: Props) {
  const [aba, setAba] = useState<'tools' | 'auditoria'>('tools');

  return (
    <aside className="flex h-full min-h-0 flex-col rounded-xl border border-slate-200 bg-white">
      <div className="flex border-b border-slate-200 text-sm">
        {(['tools', 'auditoria'] as const).map((a) => (
          <button
            key={a}
            onClick={() => {
              setAba(a);
              if (a === 'auditoria') onCarregarAuditoria();
            }}
            className={`flex-1 py-2 ${aba === a ? 'border-b-2 border-slate-900 font-medium' : 'text-slate-500'}`}
          >
            {a === 'tools' ? 'Ferramentas' : 'Auditoria'}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {aba === 'tools' ? (
          itens.length === 0 ? (
            <p className="text-sm text-slate-400">Nenhuma ferramenta chamada ainda.</p>
          ) : (
            <ol className="space-y-2">
              {itens.map((t) => (
                <li key={t.id} className="rounded-md border border-slate-200 p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{nomeTool(t.name)}</span>
                    <span className={`rounded px-1.5 py-0.5 ${COR[t.status]}`}>
                      {t.status}
                      {t.latencyMs !== undefined && ` · ${t.latencyMs} ms`}
                    </span>
                  </div>
                  <Detalhe rotulo="entrada" valor={t.input} />
                  {t.output !== undefined && <Detalhe rotulo="saída" valor={t.output} />}
                </li>
              ))}
            </ol>
          )
        ) : auditoria === null ? (
          <p className="text-sm text-slate-400">Carregando…</p>
        ) : (
          <ol className="space-y-1 font-mono text-[11px]">
            {auditoria.map((e) => (
              <li key={e.seq} className="border-b border-slate-100 pb-1">
                <span className="text-slate-400">#{e.seq}</span> <span className="font-semibold">{e.event.type}</span>{' '}
                <span className="text-slate-600">{resumo(e)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}

function Detalhe({ rotulo, valor }: { rotulo: string; valor: unknown }) {
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-slate-500">{rotulo}</summary>
      <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-1.5">{JSON.stringify(valor, null, 2)}</pre>
    </details>
  );
}

function resumo(e: AuditEntry): string {
  const ev = e.event as Record<string, any>;
  switch (ev.type) {
    case 'user_message':
      return `"${ev.text}"`;
    case 'llm_usage':
      return `${ev.usage?.input_tokens ?? 0} in / ${ev.usage?.output_tokens ?? 0} out · ${formatarCusto(ev.costCents)}`;
    case 'tool_call':
      return `${ev.name} ${JSON.stringify(ev.input)}`;
    case 'tool_result':
      return `${ev.name} ${ev.ok ? 'ok' : 'erro'} · ${ev.latencyMs} ms`;
    case 'confirmation_required':
      return ev.summary;
    case 'confirmation_resolved':
      return `${ev.name} → ${ev.approved ? 'aprovada' : 'recusada'}`;
    case 'tool_denied':
      return `${ev.name} (${ev.codigo})`;
    case 'done':
      return ev.reason;
    default:
      return '';
  }
}
