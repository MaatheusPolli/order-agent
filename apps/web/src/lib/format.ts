export const NOMES_TOOLS: Record<string, string> = {
  buscar_pedido: 'Buscar pedido',
  listar_pedidos_cliente: 'Listar pedidos',
  rastrear_entrega: 'Rastrear entrega',
  consultar_politica_troca: 'Política de troca',
  gerar_segunda_via: 'Segunda via do boleto',
  abrir_chamado: 'Abrir chamado',
  solicitar_cancelamento: 'Cancelar pedido',
};

export const nomeTool = (n: string) => NOMES_TOOLS[n] ?? n;

/** Custo em centavos de dólar → "US$ 0,0123". */
export function formatarCusto(cents: number): string {
  return `US$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
}

export function formatarCpf(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
}
