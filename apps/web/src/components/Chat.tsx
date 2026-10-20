import { useEffect, useRef, useState, type FormEvent } from 'react';

export interface Mensagem {
  role: 'user' | 'assistant' | 'sistema';
  text: string;
}

interface Props {
  mensagens: Mensagem[];
  ocupado: boolean;
  bloqueado: boolean;
  onEnviar: (texto: string) => void;
}

export function Chat({ mensagens, ocupado, bloqueado, onEnviar }: Props) {
  const [texto, setTexto] = useState('');
  const fim = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensagens]);

  function enviar(e: FormEvent) {
    e.preventDefault();
    const t = texto.trim();
    if (!t || ocupado) return;
    onEnviar(t);
    setTexto('');
  }

  return (
    <section className="flex h-full min-h-0 flex-col rounded-xl border border-slate-200 bg-white">
      <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
        {mensagens.length === 0 && (
          <p className="text-sm text-slate-400">Pergunte sobre status, rastreio, segunda via, troca ou cancelamento.</p>
        )}
        {mensagens.map((m, i) => (
          <div
            key={i}
            className={
              m.role === 'user'
                ? 'ml-auto max-w-[80%] rounded-lg bg-slate-900 px-3 py-2 text-sm text-white'
                : m.role === 'sistema'
                  ? 'mx-auto max-w-[90%] text-center text-xs text-slate-500'
                  : 'max-w-[80%] whitespace-pre-wrap rounded-lg bg-slate-100 px-3 py-2 text-sm'
            }
          >
            {m.text || (ocupado && i === mensagens.length - 1 ? '…' : '')}
          </div>
        ))}
        <div ref={fim} />
      </div>
      <form onSubmit={enviar} className="flex gap-2 border-t border-slate-200 p-3">
        <input
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={bloqueado ? 'Responda à confirmação acima…' : 'Escreva sua mensagem'}
          disabled={ocupado}
          maxLength={2000}
        />
        <button
          disabled={ocupado || !texto.trim()}
          className="rounded-md bg-slate-900 px-4 text-sm font-medium text-white disabled:opacity-50"
        >
          Enviar
        </button>
      </form>
    </section>
  );
}
