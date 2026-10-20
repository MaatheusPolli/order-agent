/**
 * RF06 — escalada para humano. Pedido explícito do cliente é tratado pelo LLM
 * (ele oferece `abrir_chamado`); aqui fica a regra que o sistema garante:
 * após N falhas de entendimento seguidas, o agente para e transfere.
 */

/** Erros de tool que indicam que o agente não entendeu o cliente (não erros de negócio legítimos). */
export const FALHAS_DE_ENTENDIMENTO = new Set(['argumentos_invalidos', 'pedido_nao_encontrado', 'tool_desconhecida']);

export const MENSAGEM_ESCALADA =
  'Não estou conseguindo localizar o que você precisa. Vou transferir seu atendimento para a nossa equipe humana, que vai continuar a partir daqui.';
