export type StatusPedido = 'aguardando_pagamento' | 'pago' | 'em_transporte' | 'entregue' | 'cancelado';
export type Categoria = 'eletronicos' | 'vestuario' | 'casa';

export interface PedidoResumo {
  numero: string;
  criadoEm: string;
  status: StatusPedido;
  totalCentavos: number;
}

export interface Pedido extends PedidoResumo {
  cpf: string;
  itens: { sku: string; descricao: string; quantidade: number; precoCentavos: number }[];
  formaPagamento: 'boleto' | 'cartao' | 'pix';
  categoria: Categoria;
  entregueEm?: string;
}

export interface Rastreio {
  codigo: string;
  transportadora: string;
  previsaoEntrega: string;
  eventos: { data: string; local: string; descricao: string }[];
}

export interface SegundaVia {
  linhaDigitavel: string;
  vencimento: string;
  valorCentavos: number;
}

export interface PoliticaTroca {
  categoria: Categoria;
  prazoArrependimentoDias: number;
  prazoDefeitoDias: number;
  condicoes: string[];
}

export interface Chamado {
  protocolo: string;
  cpf: string;
  numeroPedido?: string;
  motivo: string;
  descricao: string;
  criadoEm: string;
}

/** Erro de negócio vindo do ERP (código estável, ex.: `boleto_ja_pago`). */
export class ErpError extends Error {
  constructor(
    readonly codigo: string,
    readonly status: number,
  ) {
    super(`ERP: ${codigo} (${status})`);
    this.name = 'ErpError';
  }
}

/** Porta para o ERP. O agente só conhece esta interface, nunca a implementação. */
export interface ErpPort {
  listarPedidos(cpf: string): Promise<PedidoResumo[]>;
  buscarPedido(numero: string): Promise<Pedido>;
  rastrear(numero: string): Promise<Rastreio>;
  gerarSegundaVia(numero: string): Promise<SegundaVia>;
  solicitarCancelamento(numero: string): Promise<{ numero: string; status: StatusPedido }>;
  politicaTroca(categoria: Categoria): Promise<PoliticaTroca>;
  abrirChamado(dados: { cpf: string; numeroPedido?: string; motivo: string; descricao: string }): Promise<Chamado>;
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** Implementação HTTP do ErpPort. `fetchFn` é injetável para testes. */
export class HttpErpClient implements ErpPort {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  private async req<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json()) as T & { erro?: string };
    if (!res.ok) throw new ErpError(json.erro ?? 'erro_desconhecido', res.status);
    return json;
  }

  listarPedidos(cpf: string) {
    return this.req<PedidoResumo[]>('GET', `/clientes/${enc(cpf)}/pedidos`);
  }
  buscarPedido(numero: string) {
    return this.req<Pedido>('GET', `/pedidos/${enc(numero)}`);
  }
  rastrear(numero: string) {
    return this.req<Rastreio>('GET', `/pedidos/${enc(numero)}/rastreio`);
  }
  gerarSegundaVia(numero: string) {
    return this.req<SegundaVia>('POST', `/pedidos/${enc(numero)}/boleto/segunda-via`);
  }
  solicitarCancelamento(numero: string) {
    return this.req<{ numero: string; status: StatusPedido }>('POST', `/pedidos/${enc(numero)}/cancelamento`);
  }
  politicaTroca(categoria: Categoria) {
    return this.req<PoliticaTroca>('GET', `/politicas/troca/${enc(categoria)}`);
  }
  abrirChamado(dados: { cpf: string; numeroPedido?: string; motivo: string; descricao: string }) {
    return this.req<Chamado>('POST', '/chamados', dados);
  }
}

const enc = encodeURIComponent;
