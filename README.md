# OrderAgent

Agente de atendimento pÃ³s-venda construÃ­do sobre Claude com **tool use**. Ele consulta status de pedido, rastreio, segunda via de boleto e polÃ­tica de troca numa API mock de ERP. Tem limites de aÃ§Ã£o, confirmaÃ§Ã£o obrigatÃ³ria para efeitos colaterais, auditoria append-only e avaliaÃ§Ã£o automatizada.

> O agente nÃ£o deveria poder cancelar seu pedido sozinho. Aqui, ele nÃ£o pode: quem decide Ã© o servidor, nÃ£o o prompt.

<!-- TODO: GIF do fluxo de confirmaÃ§Ã£o (docs/confirmacao.gif) -->

## Como funciona

```
UI (React) â”€â”€SSEâ”€â”€â–º API (Fastify) â”€â”€ sessÃ£o: CPF + nÂº do pedido (RF04)
                       â”‚
                  AgentRunner  (loop explÃ­cito, mÃ¡x. 8 iteraÃ§Ãµes, teto de custo)
                   â”‚
                   â”œâ”€â–º Claude (tools + system prompt cacheado)
                   â”‚      â”‚ tool_use
                   â”‚      â–¼
                   â”œâ”€â–º ToolRegistry â”€â”€ valida args com Zod (mesmo schema que gera a definition)
                   â”œâ”€â–º Authorizer â”€â”€â”€â”€ read â†’ executa Â· effect â†’ PAUSA e pede confirmaÃ§Ã£o
                   â”œâ”€â–º handler â”€â”€â”€â”€â”€â”€â”€ filtra pelo CPF da sessÃ£o (nunca pelo que o LLM diz)
                   â”œâ”€â–º AuditLog â”€â”€â”€â”€â”€â”€ tudo gravado, append-only
                   â”‚      â”‚ tool_result
                   â””â”€â”€â”€â”€â”€â”€â”˜ repete atÃ©: resposta final | confirmaÃ§Ã£o | limite | escalada
```

### Ferramentas

| Tool | PolÃ­tica | O que faz |
|---|---|---|
| `buscar_pedido` | leitura | Status, itens, valor e entrega de um pedido |
| `listar_pedidos_cliente` | leitura | Pedidos do cliente autenticado |
| `rastrear_entrega` | leitura | Rastreio + flag `atrasado` calculada no servidor |
| `consultar_politica_troca` | leitura | PolÃ­tica da categoria + elegibilidade por dias desde a entrega |
| `gerar_segunda_via` | **efeito** | Nova via do boleto (confirmaÃ§Ã£o obrigatÃ³ria) |
| `abrir_chamado` | **efeito** | Chamado para a equipe humana (confirmaÃ§Ã£o obrigatÃ³ria) |
| `solicitar_cancelamento` | **efeito** | Cancela pedido nÃ£o enviado (confirmaÃ§Ã£o obrigatÃ³ria) |

### Garantias que nÃ£o dependem do prompt

- **Isolamento entre clientes**: os handlers usam o CPF da sessÃ£o. Pedido de outro cliente responde como "nÃ£o encontrado", mesmo sob prompt injection. Ver `tests/integration/confirmation.test.ts`.
- **ConfirmaÃ§Ã£o**: tool de efeito pausa o turno e guarda os argumentos no servidor. SÃ³ executa o que o cliente viu e aprovou.
- **Limites**: 8 iteraÃ§Ãµes por mensagem, teto de custo por conversa e escalada apÃ³s 3 falhas de entendimento seguidas.
- **Auditoria**: cada mensagem, tool call (args, resultado, latÃªncia), confirmaÃ§Ã£o, uso de tokens e custo. No Postgres, um trigger bloqueia UPDATE/DELETE.

## Rodando

Requisitos: Node 20+, pnpm 9. Postgres Ã© opcional (sem `DATABASE_URL` a auditoria fica em memÃ³ria).

```bash
pnpm install
cp .env.example .env   # preencha ANTHROPIC_API_KEY
```

Em trÃªs terminais:

```bash
pnpm dev:erp
```

```bash
pnpm dev:api
```

```bash
pnpm dev:web
```

Abra http://localhost:5173 e entre com os dados fictÃ­cios, por exemplo CPF `111.111.111-11` e pedido `1001`.

| Cliente | CPF | Pedidos (cenÃ¡rio) |
|---|---|---|
| Ana | 111.111.111-11 | 1001 atrasado Â· 1002 entregue, dentro do prazo de troca |
| Bruno | 222.222.222-22 | 2001 boleto vencido Â· 2002 cancelado |
| Carla | 333.333.333-33 | 3001 pago, sem rastreio Â· 3002 entregue hÃ¡ 82 dias |

Com Docker: `docker compose up` sobe Postgres e ERP mock.

## Testes e avaliaÃ§Ã£o

```bash
pnpm test:cov
```

A suÃ­te roda o LLM a partir de transcripts gravados, entÃ£o Ã© determinÃ­stica e nÃ£o tem custo. A cobertura mÃ­nima exigida Ã© de 85%.

```bash
pnpm eval --live
```

Roda as 17 conversas de `eval/conversas.jsonl` contra o Claude de verdade (**gera custo**) e escreve `report/eval.md`. As mÃ©tricas sÃ£o acerto de tool, taxa de alucinaÃ§Ã£o (entidades da resposta sem fonte nas tools) e escalada correta.

## Stack

TypeScript Â· `@anthropic-ai/sdk` (streaming, prompt caching) Â· Zod â†’ JSON Schema Â· Fastify + SSE Â· PostgreSQL Â· React + Vite + Tailwind Â· Vitest.


## Licença

### Uso Pessoal
Este projeto é licenciado sob a **Licença MIT** para uso pessoal, educacional e não comercial.

### Uso Comercial
Se você deseja usar este projeto comercialmente, deve obter uma licença comercial do autor.

**Uso comercial inclui:**
- Incorporar em um produto comercial
- Oferecer como serviço
- Usar em atividades com fins lucrativos
- Implantação empresarial

**Para obter uma licença comercial:**
Email: ma.polli@hotmail.com
