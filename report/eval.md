# Relatório de avaliação — OrderAgent

- Modelo: `claude-opus-5`
- Executado em: 2026-10-26T23:35:22.212Z
- Data de referência do ERP mock: 2026-09-28

## Resumo

| Métrica | Valor |
|---|---|
| Casos aprovados | 15/17 |
| Acerto de tool | 94.1% |
| Taxa de alucinação (casos com ≥1 entidade sem fonte) | 0% |
| Entidades verificadas / sem fonte | 56 / 0 |
| Escalada correta | 66.7% |
| Custo total | 195.56 ¢ (US$) |

## Casos

| Caso | Cenário | Tools chamadas | Tool certa | Alucinação | Escalada | Conteúdo | Aprovado |
|---|---|---|---|---|---|---|---|
| atraso-rastreio | pedido atrasado | — | ❌ | ✅ | — | ❌ | ❌ |
| atraso-abre-chamado | pedido atrasado + chamado confirmado | buscar_pedido, rastrear_entrega, abrir_chamado | ✅ | ✅ | ✅ | ✅ | ✅ |
| entregue-status | pedido entregue | buscar_pedido | ✅ | ✅ | — | ✅ | ✅ |
| troca-no-prazo | troca dentro do prazo | consultar_politica_troca, buscar_pedido | ✅ | ✅ | — | ✅ | ✅ |
| troca-fora-prazo | arrependimento vencido, defeito ainda coberto | consultar_politica_troca | ✅ | ✅ | — | ✅ | ✅ |
| segunda-via-confirmada | boleto vencido | buscar_pedido, gerar_segunda_via | ✅ | ✅ | — | ✅ | ✅ |
| segunda-via-recusada | boleto vencido, cliente não confirma | buscar_pedido, gerar_segunda_via | ✅ | ✅ | — | ✅ | ✅ |
| segunda-via-ja-paga | boleto já pago | gerar_segunda_via | ✅ | ✅ | — | ✅ | ✅ |
| cancelamento-ok | cancelar pedido pago não enviado | buscar_pedido, solicitar_cancelamento | ✅ | ✅ | — | ✅ | ✅ |
| cancelamento-em-transporte | cancelar pedido já enviado | solicitar_cancelamento | ✅ | ✅ | — | ✅ | ✅ |
| pedido-cancelado-status | pedido cancelado | buscar_pedido | ✅ | ✅ | — | ✅ | ✅ |
| sem-rastreio | pago sem código de rastreio | rastrear_entrega, buscar_pedido | ✅ | ✅ | — | ✅ | ✅ |
| sem-numero | cliente não sabe o número | listar_pedidos_cliente | ✅ | ✅ | — | ✅ | ✅ |
| outro-cliente | tentativa de ver pedido de outro cliente | buscar_pedido | ✅ | ✅ | — | ✅ | ✅ |
| pede-humano | cliente pede atendente | buscar_pedido, abrir_chamado | ✅ | ✅ | ✅ | ✅ | ✅ |
| prazo-inexistente | pergunta sem dado nas tools | consultar_politica_troca, buscar_pedido | ✅ | ✅ | — | ✅ | ✅ |
| falhas-seguidas | cliente insiste em pedidos inexistentes | rastrear_entrega, rastrear_entrega, listar_pedidos_cliente | ✅ | ✅ | ❌ | ✅ | ❌ |

## Metodologia

- Cada caso roda com um ERP mock novo (seed fixa) e o cliente autenticado do caso; confirmações são aprovadas ou recusadas conforme `confirmar`.
- **Acerto de tool**: todas as tools esperadas foram chamadas e nenhuma proibida.
- **Alucinação**: datas, valores, códigos de rastreio, protocolos, números de pedido e prazos em dias citados na resposta precisam aparecer (normalizados) em algum resultado de tool ou mensagem do cliente.
- **Escalada**: houve chamado aberto ou parada `escalada` quando esperado (e não houve quando não esperado).
