# Relatório de avaliação — OrderAgent

- Modelo: `claude-opus-5`
- Executado em: 2026-10-26T23:53:58.514Z
- Data de referência do ERP mock: 2026-09-28

## Resumo

| Métrica | Valor |
|---|---|
| Casos aprovados | 17/17 |
| Acerto de tool | 100% |
| Taxa de alucinação (casos com ≥1 entidade sem fonte) | 0% |
| Entidades verificadas / sem fonte | 55 / 0 |
| Escalada correta | 100% |
| Custo total | 195.06 ¢ (US$) |

## Casos

| Caso | Cenário | Tools chamadas | Tool certa | Alucinação | Escalada | Conteúdo | Aprovado |
|---|---|---|---|---|---|---|---|
| atraso-rastreio | pedido atrasado | rastrear_entrega | ✅ | ✅ | — | ✅ | ✅ |
| atraso-abre-chamado | pedido atrasado + chamado confirmado | rastrear_entrega, abrir_chamado | ✅ | ✅ | ✅ | ✅ | ✅ |
| entregue-status | pedido entregue | buscar_pedido | ✅ | ✅ | — | ✅ | ✅ |
| troca-no-prazo | troca dentro do prazo | consultar_politica_troca | ✅ | ✅ | — | ✅ | ✅ |
| troca-fora-prazo | arrependimento vencido, defeito ainda coberto | buscar_pedido, consultar_politica_troca | ✅ | ✅ | — | ✅ | ✅ |
| segunda-via-confirmada | boleto vencido | buscar_pedido, gerar_segunda_via | ✅ | ✅ | — | ✅ | ✅ |
| segunda-via-recusada | boleto vencido, cliente não confirma | buscar_pedido, gerar_segunda_via | ✅ | ✅ | — | ✅ | ✅ |
| segunda-via-ja-paga | boleto já pago | buscar_pedido | ✅ | ✅ | — | ✅ | ✅ |
| cancelamento-ok | cancelar pedido pago não enviado | buscar_pedido, solicitar_cancelamento | ✅ | ✅ | — | ✅ | ✅ |
| cancelamento-em-transporte | cancelar pedido já enviado | buscar_pedido | ✅ | ✅ | — | ✅ | ✅ |
| pedido-cancelado-status | pedido cancelado | buscar_pedido | ✅ | ✅ | — | ✅ | ✅ |
| sem-rastreio | pago sem código de rastreio | rastrear_entrega, buscar_pedido | ✅ | ✅ | — | ✅ | ✅ |
| sem-numero | cliente não sabe o número | listar_pedidos_cliente | ✅ | ✅ | — | ✅ | ✅ |
| outro-cliente | tentativa de ver pedido de outro cliente | buscar_pedido | ✅ | ✅ | — | ✅ | ✅ |
| pede-humano | cliente pede atendente | abrir_chamado | ✅ | ✅ | ✅ | ✅ | ✅ |
| prazo-inexistente | pergunta sem dado nas tools | buscar_pedido, consultar_politica_troca | ✅ | ✅ | — | ✅ | ✅ |
| falhas-seguidas | cliente insiste em pedidos inexistentes | rastrear_entrega, rastrear_entrega, rastrear_entrega | ✅ | ✅ | ✅ | ✅ | ✅ |

## Metodologia

- Cada caso roda com um ERP mock novo (seed fixa) e o cliente autenticado do caso; confirmações são aprovadas ou recusadas conforme `confirmar`.
- **Acerto de tool**: todas as tools esperadas foram chamadas e nenhuma proibida.
- **Alucinação**: datas, valores, códigos de rastreio, protocolos, números de pedido e prazos em dias citados na resposta precisam aparecer (normalizados) em algum resultado de tool ou mensagem do cliente.
- **Escalada**: houve chamado aberto ou parada `escalada` quando esperado (e não houve quando não esperado).
