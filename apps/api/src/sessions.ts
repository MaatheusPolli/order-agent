import { randomBytes, randomUUID } from 'node:crypto';
import { ErpError, newConversation, type Conversation, type ErpPort } from '@order-agent/agent';

export interface Sessao {
  token: string;
  cpf: string;
  nome?: string;
}

export interface ConversaRegistro {
  conv: Conversation;
  cpf: string;
  criadaEm: string;
  /** Uma mensagem por vez por conversa (evita histórico intercalado). */
  ocupada: boolean;
}

export class ErroIdentificacao extends Error {}

/**
 * RF04: o cliente se identifica com CPF + número de um pedido dele. A sessão
 * (e só ela) define o CPF usado pelas tools — o LLM nunca escolhe o cliente.
 */
export class SessionStore {
  private readonly sessoes = new Map<string, Sessao>();
  private readonly conversas = new Map<string, ConversaRegistro>();

  constructor(private readonly erp: ErpPort) {}

  async identificar(cpfBruto: string, numeroPedido: string): Promise<Sessao> {
    const cpf = cpfBruto.replace(/\D/g, '');
    if (!/^\d{11}$/.test(cpf) || !/^\d{3,10}$/.test(numeroPedido)) {
      throw new ErroIdentificacao('CPF ou número de pedido inválido.');
    }
    try {
      const pedido = await this.erp.buscarPedido(numeroPedido);
      // Mesma resposta para "pedido não existe" e "pedido de outro CPF": não vaza existência.
      if (pedido.cpf !== cpf) throw new ErroIdentificacao('Não encontramos esse pedido para esse CPF.');
    } catch (e) {
      if (e instanceof ErpError && e.status === 404) {
        throw new ErroIdentificacao('Não encontramos esse pedido para esse CPF.');
      }
      throw e;
    }
    const sessao = { token: randomBytes(24).toString('base64url'), cpf };
    this.sessoes.set(sessao.token, sessao);
    return sessao;
  }

  sessao(token: string | undefined): Sessao | undefined {
    return token ? this.sessoes.get(token) : undefined;
  }

  novaConversa(cpf: string, agora: Date): ConversaRegistro {
    const reg: ConversaRegistro = { conv: newConversation(randomUUID()), cpf, criadaEm: agora.toISOString(), ocupada: false };
    this.conversas.set(reg.conv.id, reg);
    return reg;
  }

  /** Conversa só é visível para o CPF dono dela. */
  conversa(id: string, cpf: string): ConversaRegistro | undefined {
    const reg = this.conversas.get(id);
    return reg && reg.cpf === cpf ? reg : undefined;
  }

  conversasDe(cpf: string): ConversaRegistro[] {
    return [...this.conversas.values()].filter((r) => r.cpf === cpf);
  }
}
