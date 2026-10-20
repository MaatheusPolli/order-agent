import type { Confirmacao } from '../lib/api';
import { nomeTool } from '../lib/format';

interface Props {
  confirmacoes: Confirmacao[];
  ocupado: boolean;
  onDecidir: (decisoes: Record<string, boolean>) => void;
}

/** RF03: nenhuma ação com efeito roda sem o cliente ver o resumo e aprovar aqui. */
export function ConfirmDialog({ confirmacoes, ocupado, onDecidir }: Props) {
  if (confirmacoes.length === 0) return null;
  const todas = (v: boolean) => Object.fromEntries(confirmacoes.map((c) => [c.id, v]));

  return (
    <div role="alertdialog" aria-labelledby="confirm-title" className="rounded-xl border-2 border-amber-400 bg-amber-50 p-4">
      <h2 id="confirm-title" className="text-sm font-semibold text-amber-900">
        Confirme antes de continuar
      </h2>
      <ul className="mt-2 space-y-2">
        {confirmacoes.map((c) => (
          <li key={c.id} className="text-sm">
            <span className="font-medium">{nomeTool(c.name)}:</span> {c.summary}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <button
          disabled={ocupado}
          onClick={() => onDecidir(todas(true))}
          className="rounded-md bg-amber-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          Confirmar
        </button>
        <button
          disabled={ocupado}
          onClick={() => onDecidir(todas(false))}
          className="rounded-md border border-amber-600 px-4 py-1.5 text-sm font-medium text-amber-800 disabled:opacity-50"
        >
          Não, cancelar
        </button>
      </div>
    </div>
  );
}
