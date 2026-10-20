import { zodToJsonSchema } from 'zod-to-json-schema';
import { ToolError, type AgentContext, type Tool } from './types.js';
import { buscarPedido } from './buscar-pedido.tool.js';
import { listarPedidosCliente } from './listar-pedidos.tool.js';
import { rastrearEntrega } from './rastrear-entrega.tool.js';
import { consultarPoliticaTroca } from './consultar-politica.tool.js';
import { gerarSegundaVia } from './gerar-segunda-via.tool.js';
import { abrirChamado } from './abrir-chamado.tool.js';
import { solicitarCancelamento } from './solicitar-cancelamento.tool.js';

/** Formato de definição de tool da API de Messages do Claude. */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  constructor(tools: Tool[]) {
    for (const tool of tools) {
      if (!/^[a-z_]{1,64}$/.test(tool.name)) throw new Error(`Nome de tool inválido: ${tool.name}`);
      if (this.tools.has(tool.name)) throw new Error(`Tool duplicada: ${tool.name}`);
      this.tools.set(tool.name, tool);
    }
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  /** Definitions geradas dos schemas Zod — não há como divergirem da validação. */
  definitions(): ToolDefinition[] {
    return this.list().map((t) => {
      const { $schema: _s, ...input_schema } = zodToJsonSchema(t.schema, { target: 'jsonSchema7' }) as Record<
        string,
        unknown
      >;
      return { name: t.name, description: t.description, input_schema };
    });
  }

  /** Valida os argumentos vindos do LLM. Lança ToolError legível em caso de falha. */
  parse(name: string, rawInput: unknown): { tool: Tool; input: unknown } {
    const tool = this.get(name);
    if (!tool) throw new ToolError('tool_desconhecida', `Ferramenta inexistente: ${name}`);
    const result = tool.schema.safeParse(rawInput ?? {});
    if (!result.success) {
      const detalhes = result.error.issues.map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`).join('; ');
      throw new ToolError('argumentos_invalidos', `Argumentos inválidos para ${name}: ${detalhes}`);
    }
    return { tool, input: result.data };
  }

  /** Valida e executa (sem checagem de política — responsabilidade do Authorizer/Runner). */
  async execute(name: string, rawInput: unknown, ctx: AgentContext): Promise<unknown> {
    const { tool, input } = this.parse(name, rawInput);
    return tool.handler(input, ctx);
  }
}

export const ALL_TOOLS: Tool[] = [
  buscarPedido,
  listarPedidosCliente,
  rastrearEntrega,
  consultarPoliticaTroca,
  gerarSegundaVia,
  abrirChamado,
  solicitarCancelamento,
];

export const createDefaultRegistry = () => new ToolRegistry(ALL_TOOLS);
