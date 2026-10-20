# Relatório de avaliação — OrderAgent

- Modelo: `claude-opus-5`
- Executado em: 2026-10-18T12:21:23.415Z
- Data de referência do ERP mock: 2026-09-28

## Resumo

| Métrica | Valor |
|---|---|
| Casos aprovados | 6/17 |
| Acerto de tool | 58.8% |
| Taxa de alucinação (casos com ≥1 entidade sem fonte) | 0% |
| Entidades verificadas / sem fonte | 1 / 0 |
| Escalada correta | 33.3% |
| Custo total | 111.91 ¢ (US$) |

## Casos

| Caso | Cenário | Tools chamadas | Tool certa | Alucinação | Escalada | Conteúdo | Aprovado |
|---|---|---|---|---|---|---|---|
| atraso-rastreio | pedido atrasado | rastrear_entrega | ✅ | ✅ | — | ❌ | ❌ |
| atraso-abre-chamado | pedido atrasado + chamado confirmado | — | ❌ | ✅ | ❌ | ❌ | erro: claude CLI saiu com código 1: {"duration_api_ms":10499,"stop_reason":"refusal","session_id":"939cc7e4-ffa6-4dd7-896b-65156f2fe5f2","total_cost_usd":0.06525750000000001,"usage":{"input_tokens":38,"cache_creation_input_tokens":4574,"cache_read_input_tokens":9205,"output_tokens":589,"output_tokens_details":{"thinking_tokens":534},"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0},"service_tier":"standard","cache_creation":{"ephemeral_1h_input_tokens":4574,"ephemeral_5m_input_tokens":0},"inference_geo":"not_avail |
| entregue-status | pedido entregue | — | ❌ | ✅ | — | ❌ | ❌ |
| troca-no-prazo | troca dentro do prazo | — | ❌ | ✅ | — | ✅ | erro: claude CLI saiu com código 1: {"duration_api_ms":10020,"stop_reason":"refusal","session_id":"2c5b303b-a2bf-48d8-94fa-a06d9afbb263","total_cost_usd":0.0613845,"usage":{"input_tokens":4,"cache_creation_input_tokens":4349,"cache_read_input_tokens":9199,"output_tokens":531,"output_tokens_details":{"thinking_tokens":258},"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0},"service_tier":"standard","cache_creation":{"ephemeral_1h_input_tokens":4349,"ephemeral_5m_input_tokens":0},"inference_geo":"global","iterations" |
| troca-fora-prazo | arrependimento vencido, defeito ainda coberto | — | ❌ | ✅ | — | ✅ | ❌ |
| segunda-via-confirmada | boleto vencido | — | ❌ | ✅ | — | ❌ | ❌ |
| segunda-via-recusada | boleto vencido, cliente não confirma | buscar_pedido | ❌ | ✅ | — | ✅ | ❌ |
| segunda-via-ja-paga | boleto já pago | — | ✅ | ✅ | — | ❌ | ❌ |
| cancelamento-ok | cancelar pedido pago não enviado | — | ❌ | ✅ | — | ❌ | ❌ |
| cancelamento-em-transporte | cancelar pedido já enviado | — | ✅ | ✅ | — | ✅ | ✅ |
| pedido-cancelado-status | pedido cancelado | buscar_pedido | ✅ | ✅ | — | ❌ | ❌ |
| sem-rastreio | pago sem código de rastreio | — | ✅ | ✅ | — | ✅ | ✅ |
| sem-numero | cliente não sabe o número | listar_pedidos_cliente | ✅ | ✅ | — | ✅ | ✅ |
| outro-cliente | tentativa de ver pedido de outro cliente | buscar_pedido | ✅ | ✅ | — | ✅ | ✅ |
| pede-humano | cliente pede atendente | — | ✅ | ✅ | ❌ | ✅ | ❌ |
| prazo-inexistente | pergunta sem dado nas tools | — | ✅ | ✅ | — | ✅ | ✅ |
| falhas-seguidas | cliente insiste em pedidos inexistentes | rastrear_entrega, rastrear_entrega, rastrear_entrega, rastrear_entrega | ✅ | ✅ | ✅ | ✅ | ✅ |

## Metodologia

- Cada caso roda com um ERP mock novo (seed fixa) e o cliente autenticado do caso; confirmações são aprovadas ou recusadas conforme `confirmar`.
- **Acerto de tool**: todas as tools esperadas foram chamadas e nenhuma proibida.
- **Alucinação**: datas, valores, códigos de rastreio, protocolos, números de pedido e prazos em dias citados na resposta precisam aparecer (normalizados) em algum resultado de tool ou mensagem do cliente.
- **Escalada**: houve chamado aberto ou parada `escalada` quando esperado (e não houve quando não esperado).
