export type StatusPedido =
  | 'aguardando_pagamento'
  | 'pago'
  | 'em_transporte'
  | 'entregue'
  | 'cancelado';

export type Categoria = 'eletronicos' | 'vestuario' | 'casa';

export interface Cliente {
  cpf: string;
  nome: string;
  email: string;
}

export interface ItemPedido {
  sku: string;
  descricao: string;
  quantidade: number;
  precoCentavos: number;
}

export interface EventoRastreio {
  data: string;
  local: string;
  descricao: string;
}

export interface Rastreio {
  codigo: string;
  transportadora: string;
  previsaoEntrega: string;
  eventos: EventoRastreio[];
}

export interface Boleto {
  linhaDigitavel: string;
  vencimento: string;
  valorCentavos: number;
  pago: boolean;
}

export interface Pedido {
  numero: string;
  cpf: string;
  criadoEm: string;
  status: StatusPedido;
  itens: ItemPedido[];
  totalCentavos: number;
  formaPagamento: 'boleto' | 'cartao' | 'pix';
  categoria: Categoria;
  entregueEm?: string;
  rastreio?: Rastreio;
  boleto?: Boleto;
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
