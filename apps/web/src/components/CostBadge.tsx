import { formatarCusto } from '../lib/format';

export function CostBadge({ cents }: { cents: number }) {
  return (
    <span
      title="Custo acumulado de LLM nesta conversa"
      className="rounded-full border border-slate-300 bg-white px-3 py-1 font-mono text-xs text-slate-700"
    >
      {formatarCusto(cents)}
    </span>
  );
}
