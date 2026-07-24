# Estratégia de Sincronização

## 1. Princípio central

Sincronização é **híbrida** e **nunca instantânea garantida**: webhook (quando
confirmado, ver `omie-api-mapping.md` §10) + atualização imediata pós-ação local +
cache TTL curto + sync incremental em background + reconciliação periódica +
atualização manual + revalidação obrigatória antes de operações críticas. Nenhuma
camada sozinha é fonte de verdade suficiente para uma decisão de venda.

## 2. Fluxo de webhook

```
Omie → POST /api/webhooks/omie/{organizationId}/{webhookSecretToken}
  → validação: organização existe, token bate, payload é JSON válido (< 7s de orçamento total)
  → persistir WebhookEvent (rawPayload bruto, status=RECEIVED) — SEMPRE antes de interpretar
  → responder 200 imediatamente
  → enfileirar job em omie-webhook-processing (idempotencyKey = dedupeKey do evento)
  → [worker] processar:
      - deduplicar (WebhookEvent.dedupeKey único — se já existe, marcar DUPLICATE e sair)
      - identificar entidade afetada
      - consultar a Omie para obter o estado atual completo (o payload do webhook
        NUNCA é aplicado diretamente — é só o gatilho, conforme confirmado que a
        Omie não documenta publicamente assinatura/garantias fortes)
      - atualizar a base local transacionalmente (upsert com verificação de
        `sourceUpdatedAt` para evitar sobrescrever com dado mais antigo — proteção
        contra evento fora de ordem)
      - invalidar cache Redis da entidade
      - publicar em Redis Pub/Sub para SSE (`org:{organizationId}:events`)
      - marcar WebhookEvent como PROCESSED
  → falha no worker: retry com backoff exponencial + jitter; após N tentativas,
    mover para fila omie-dead-letter, status FAILED, visível no painel admin para
    reprocessamento manual
```

Como a lista completa de tópicos de webhook ainda não está confirmada (ver
mapping §10), a Fase 6 implementa primeiro um **handler genérico** que sempre
persiste o payload bruto e cria uma tarefa de reconciliação para a entidade
provável (por heurística de campos presentes no payload), e handlers específicos
por tópico são adicionados incrementalmente conforme confirmados no portal.

## 3. Sync incremental em background

Para entidades sem webhook confirmado (hoje: praticamente todas, até a
confirmação da seção 10 do mapping), o mecanismo primário é **polling
incremental** usando os filtros de data que várias listagens Omie já expõem
(`filtrar_por_data_de/ate`, `dDtIncDe/Ate`, `dDtAltDe/Ate` — nomes variam por
serviço, ver mapping): cada `SyncJob` guarda um cursor (última data processada
com sucesso) e retoma dali na próxima execução, evitando reprocessar tudo.

| Domínio | Intervalo inicial sugerido | Justificativa |
|---|---|---|
| Estoque | 30–60s (configurável) | Alto impacto de decisão comercial, mas evitar estourar rate limit de 240 req/min |
| Produtos | Incremental a cada 5–15 min | Baixa volatilidade |
| Clientes | Incremental a cada 5–15 min | Baixa volatilidade |
| Tabelas de preço | 5–15 min | Preço final sempre revalidado no momento crítico de qualquer forma |
| Cadastros auxiliares (vendedores, locais, parcelas) | 1–24h | Muda raramente |
| Pedidos/orçamentos recentes | 1–5 min (apenas os que estão `SYNCED` recentemente ou `SYNC_FAILED`) | Confirmar que o status no Omie não mudou por ação fora do app |
| Reconciliação completa | Janela de menor movimento (configurável, ex. madrugada) | Custo alto, feito raramente |

Todos os intervalos são configuráveis por organização em `OrganizationSettings`
— nunca hardcoded, respeitando o limite de 240 req/min compartilhado.

## 4. Cache (Redis)

Chaves com isolamento de organização, conforme briefing §21:
```
org:{organizationId}:product:{productId}
org:{organizationId}:inventory:{warehouseId}:{productId}
org:{organizationId}:price-table:{priceTableId}:{productId}
```
TTLs: produtos 5–30min; tabelas de preço 5–15min; estoque 15–60s; cadastros
auxiliares 1–24h. Invalidação ativa (não só TTL) ao: processar webhook, terminar
sync job, enviar pedido, admin pedir refresh manual, alteração local de produto/preço.

## 5. Reconciliação periódica

Job dedicado por domínio (fila `omie-reconciliation`) que compara amostra/total
da base local com a Omie (via listagem paginada com cursor retomável — nunca
carrega tudo em memória, respeita `nPagina`/`registros_por_pagina` de cada
serviço). Registra: início, fim, total consultado, total alterado, falhas,
duração, página/cursor, próxima execução (`SyncJob`). Detecta:
- registros que existem na Omie e não localmente (cria);
- registros alterados na Omie desde `lastSyncAt` (atualiza, respeitando "Omie
  prevalece para entidades mestres" — ver `docs/api-contracts.md` / política de
  conflito);
- registros locais `SYNC_FAILED` há muito tempo (alerta administrativo).

## 6. Idempotência

- **Chave de integração persistente**: `codigo_pedido_integracao` /
  `codigo_cliente_integracao` gerados **uma única vez** por registro local
  (UUID ou `organizationId:entityType:localEntityId`) e reutilizados em todo
  retry — nunca regenerados.
- **Antes de repetir uma inclusão após timeout/erro incerto**: (1) procurar
  localmente se já foi marcado `SYNCED`; (2) consultar a Omie pelo código de
  integração (`ConsultarPedido`/`ConsultarCliente` por integração, quando
  disponível) ou pelo `omieId` se já capturado numa resposta parcial; (3) só
  então decidir por novo envio. Cada tentativa é registrada em
  `IntegrationAttempt`.
- **Idempotency key de UI**: toda ação crítica (criar pedido, converter
  orçamento) exige uma `IdempotencyKey` gerada no primeiro clique
  (client-side, UUID) e validada no backend com `INSERT ... ON CONFLICT DO
  NOTHING` + retorno do resultado cacheado se a chave já existe — isso é o que
  impede duplo clique de gerar dois pedidos, combinado com desabilitar o botão
  durante o processamento e um lock distribuído Redis por
  `organizationId:idempotencyKey` durante a janela de execução.

## 7. Classificação de erro (filas)

```
RETRYABLE               // timeout, 5xx, rate limit
NON_RETRYABLE           // validação, dado inválido, duplicidade definitiva
UNCERTAIN_RESULT        // timeout no meio da escrita — exige consulta antes de repetir
AUTHENTICATION_REQUIRED // app_key/app_secret inválidos — pausa a integração, alerta admin
MANUAL_REVIEW_REQUIRED  // conflito de dado mestre, ex. cliente alterado nos dois lados
```

## 8. Atualização da interface

SSE (`/api/events`, ver `architecture.md` §4) dispara refetch do TanStack Query
correspondente quando: sync termina, pedido confirma/falha, estoque atualiza,
aprovação ocorre, webhook altera entidade relevante. A atualização visual é
**sempre cosmética** — toda ação crítica revalida no backend antes de persistir,
nunca confiando no estado otimista da tela.

## 9. Política de conflito (resumo — detalhe em `security.md`/domínio)

Princípio: **Omie prevalece para entidades mestres e situação oficial**
(produto, cliente sincronizado, status de pedido). **Aplicação prevalece apenas
para rascunhos e configurações internas** (Quote em `DRAFT`, `OrganizationSettings`,
permissões). Todo conflito detectado gera `syncStatus = CONFLICT`, um registro
de auditoria, uma notificação administrativa e nunca perda silenciosa de dado —
o valor "perdedor" fica preservado em `AuditLog.beforeData` para revisão manual.
