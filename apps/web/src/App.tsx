import { useCallback, useState } from 'react';
import { api, type AuditEntry, type Confirmacao, type TimelineItem } from './lib/api';
import { postSse, type SseEvent } from './lib/sse';
import { Login } from './components/Login';
import { Chat, type Mensagem } from './components/Chat';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ToolTimeline } from './components/ToolTimeline';
import { CostBadge } from './components/CostBadge';

export function App() {
  const [token, setToken] = useState<string | null>(null);
  const [conversaId, setConversaId] = useState<string | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [confirmacoes, setConfirmacoes] = useState<Confirmacao[]>([]);
  const [custo, setCusto] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const [auditoria, setAuditoria] = useState<AuditEntry[] | null>(null);

  const atualizarTool = (id: string, patch: Partial<TimelineItem>) =>
    setTimeline((t) => t.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const anexarTexto = (delta: string) =>
    setMensagens((ms) => {
      const ultima = ms.at(-1);
      if (ultima?.role === 'assistant') return [...ms.slice(0, -1), { ...ultima, text: ultima.text + delta }];
      return [...ms, { role: 'assistant', text: delta }];
    });

  const onEvent = useCallback((e: SseEvent) => {
    const d = e.data;
    switch (e.event) {
      case 'text':
        anexarTexto(d.delta);
        break;
      case 'tool_call':
        // Texto depois de uma tool começa um novo balão.
        setMensagens((ms) => (ms.at(-1)?.role === 'assistant' && ms.at(-1)!.text ? [...ms, { role: 'assistant', text: '' }] : ms));
        setTimeline((t) => [...t, { id: d.id, name: d.name, input: d.input, status: 'executando' }]);
        break;
      case 'tool_result':
        atualizarTool(d.id, { status: d.ok ? 'ok' : 'erro', output: d.output, latencyMs: d.latencyMs });
        break;
      case 'tool_denied':
        atualizarTool(d.id, { status: 'negada' });
        break;
      case 'confirmation_required':
        atualizarTool(d.id, { status: 'aguardando' });
        break;
      case 'confirmation_resolved':
        atualizarTool(d.id, { status: d.approved ? 'aprovada' : 'recusada' });
        break;
      case 'end':
        setCusto(d.custoConversaCents);
        setConfirmacoes(d.reason === 'aguardando_confirmacao' ? d.confirmations : []);
        setMensagens((ms) => ms.filter((m) => m.role !== 'assistant' || m.text));
        break;
      case 'error':
        setMensagens((ms) => [...ms, { role: 'sistema', text: d.mensagem }]);
        break;
    }
  }, []);

  async function comStream(fn: (token: string, id: string) => Promise<void>) {
    if (!token) return;
    setOcupado(true);
    setAuditoria(null);
    try {
      const id = conversaId ?? (await api.novaConversa(token));
      setConversaId(id);
      await fn(token, id);
    } catch (err) {
      setMensagens((ms) => [...ms, { role: 'sistema', text: `Erro: ${(err as Error).message}` }]);
    } finally {
      setOcupado(false);
    }
  }

  const enviar = (texto: string) =>
    comStream(async (t, id) => {
      setMensagens((ms) => [...ms, { role: 'user', text: texto }]);
      setConfirmacoes([]); // nova mensagem = pendência recusada no servidor
      await postSse(api.mensagensUrl(id), { texto }, t, onEvent);
    });

  const decidir = (decisoes: Record<string, boolean>) =>
    comStream(async (t, id) => {
      const aprovou = Object.values(decisoes).some(Boolean);
      setMensagens((ms) => [...ms, { role: 'sistema', text: aprovou ? 'Você confirmou a ação.' : 'Você não confirmou a ação.' }]);
      setConfirmacoes([]);
      await postSse(api.confirmacoesUrl(id), { decisoes }, t, onEvent);
    });

  const carregarAuditoria = async () => {
    if (!token || !conversaId) return setAuditoria([]);
    setAuditoria((await api.painel(token, conversaId)).auditoria);
  };

  if (!token) return <Login onEntrar={setToken} />;

  return (
    <div className="mx-auto flex h-screen max-w-6xl flex-col gap-3 p-4">
      <header className="flex items-center justify-between">
        <h1 className="font-semibold">OrderAgent · atendimento pós-venda</h1>
        <div className="flex items-center gap-3">
          <CostBadge cents={custo} />
          <button onClick={() => location.reload()} className="text-sm text-slate-500 underline">
            Sair
          </button>
        </div>
      </header>
      <main className="grid min-h-0 flex-1 gap-3 md:grid-cols-[1fr_340px]">
        <div className="flex min-h-0 flex-col gap-3">
          <ConfirmDialog confirmacoes={confirmacoes} ocupado={ocupado} onDecidir={decidir} />
          <Chat mensagens={mensagens} ocupado={ocupado} bloqueado={confirmacoes.length > 0} onEnviar={enviar} />
        </div>
        <ToolTimeline itens={timeline} auditoria={auditoria} onCarregarAuditoria={carregarAuditoria} />
      </main>
    </div>
  );
}
