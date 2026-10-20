import type { Cliente, Pedido, PoliticaTroca } from './types.js';

/** Data de referência fixa: todos os cenários são relativos a ela (reprodutibilidade). */
export const HOJE = '2026-09-28';

export const clientes: Cliente[] = [
  { cpf: '11111111111', nome: 'Ana Souza', email: 'ana@example.com' },
  { cpf: '22222222222', nome: 'Bruno Lima', email: 'bruno@example.com' },
  { cpf: '33333333333', nome: 'Carla Dias', email: 'carla@example.com' },
];

const fone = { sku: 'FONE-01', descricao: 'Fone Bluetooth', quantidade: 1, precoCentavos: 19990 };
const camiseta = { sku: 'CAM-02', descricao: 'Camiseta Algodão M', quantidade: 2, precoCentavos: 4990 };
const panela = { sku: 'PAN-03', descricao: 'Jogo de Panelas', quantidade: 1, precoCentavos: 34990 };

export const pedidos: Pedido[] = [
  // Cenário: pedido ATRASADO (previsão já passou, ainda em transporte)
  {
    numero: '1001', cpf: '11111111111', criadoEm: '2026-09-10', status: 'em_transporte',
    itens: [fone], totalCentavos: 19990, formaPagamento: 'cartao', categoria: 'eletronicos',
    rastreio: {
      codigo: 'BR123456789', transportadora: 'Correios', previsaoEntrega: '2026-09-20',
      eventos: [
        { data: '2026-09-12', local: 'São Paulo/SP', descricao: 'Objeto postado' },
        { data: '2026-09-15', local: 'Curitiba/PR', descricao: 'Em trânsito para unidade de distribuição' },
      ],
    },
  },
  // Cenário: ENTREGUE dentro do prazo de troca
  {
    numero: '1002', cpf: '11111111111', criadoEm: '2026-09-01', status: 'entregue',
    itens: [camiseta], totalCentavos: 9980, formaPagamento: 'pix', categoria: 'vestuario',
    entregueEm: '2026-09-24',
    rastreio: {
      codigo: 'BR987654321', transportadora: 'Correios', previsaoEntrega: '2026-09-25',
      eventos: [
        { data: '2026-09-20', local: 'São Paulo/SP', descricao: 'Objeto postado' },
        { data: '2026-09-24', local: 'Campinas/SP', descricao: 'Objeto entregue ao destinatário' },
      ],
    },
  },
  // Cenário: BOLETO VENCIDO
  {
    numero: '2001', cpf: '22222222222', criadoEm: '2026-09-18', status: 'aguardando_pagamento',
    itens: [panela], totalCentavos: 34990, formaPagamento: 'boleto', categoria: 'casa',
    boleto: {
      linhaDigitavel: '34191.79001 01043.510047 91020.150008 1 99990000034990',
      vencimento: '2026-09-21', valorCentavos: 34990, pago: false,
    },
  },
  // Cenário: CANCELADO
  {
    numero: '2002', cpf: '22222222222', criadoEm: '2026-08-30', status: 'cancelado',
    itens: [fone], totalCentavos: 19990, formaPagamento: 'cartao', categoria: 'eletronicos',
  },
  // Cenário: PAGO, ainda sem rastreio; boleto já pago
  {
    numero: '3001', cpf: '33333333333', criadoEm: '2026-09-26', status: 'pago',
    itens: [panela], totalCentavos: 34990, formaPagamento: 'boleto', categoria: 'casa',
    boleto: {
      linhaDigitavel: '34191.79001 01043.510047 91020.150008 2 99990000034990',
      vencimento: '2026-09-29', valorCentavos: 34990, pago: true,
    },
  },
  // Cenário: ENTREGUE fora do prazo de arrependimento
  {
    numero: '3002', cpf: '33333333333', criadoEm: '2026-07-01', status: 'entregue',
    itens: [fone], totalCentavos: 19990, formaPagamento: 'cartao', categoria: 'eletronicos',
    entregueEm: '2026-07-08',
  },
];

export const politicas: PoliticaTroca[] = [
  {
    categoria: 'eletronicos', prazoArrependimentoDias: 7, prazoDefeitoDias: 90,
    condicoes: ['Produto na embalagem original', 'Acompanhado de nota fiscal', 'Sem sinais de mau uso'],
  },
  {
    categoria: 'vestuario', prazoArrependimentoDias: 30, prazoDefeitoDias: 30,
    condicoes: ['Etiqueta afixada', 'Peça sem uso e sem lavagem'],
  },
  {
    categoria: 'casa', prazoArrependimentoDias: 7, prazoDefeitoDias: 90,
    condicoes: ['Produto na embalagem original', 'Acompanhado de nota fiscal'],
  },
];
