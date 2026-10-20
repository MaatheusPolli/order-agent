import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { formatarCpf } from '../lib/format';

export function Login({ onEntrar }: { onEntrar: (token: string) => void }) {
  const [cpf, setCpf] = useState('');
  const [pedido, setPedido] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      onEntrar(await api.entrar(cpf, pedido));
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="mx-auto mt-24 w-full max-w-sm space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <h1 className="text-lg font-semibold">Atendimento pós-venda</h1>
        <p className="text-sm text-slate-500">Para começar, informe seu CPF e o número de um pedido.</p>
      </div>
      <label className="block text-sm">
        CPF
        <input
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
          inputMode="numeric"
          value={cpf}
          onChange={(e) => setCpf(formatarCpf(e.target.value))}
          placeholder="000.000.000-00"
          required
        />
      </label>
      <label className="block text-sm">
        Número do pedido
        <input
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
          inputMode="numeric"
          value={pedido}
          onChange={(e) => setPedido(e.target.value.replace(/\D/g, ''))}
          placeholder="1001"
          required
        />
      </label>
      {erro && <p className="text-sm text-red-600">{erro}</p>}
      <button
        disabled={enviando}
        className="w-full rounded-md bg-slate-900 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {enviando ? 'Verificando…' : 'Entrar'}
      </button>
      <p className="text-xs text-slate-400">Dados fictícios de teste: CPF 111.111.111-11 e pedido 1001.</p>
    </form>
  );
}
