# Contratos de API Internos

Estes são os contratos entre o frontend e o backend **da nossa aplicação**
(nunca o formato bruto da Omie — isso fica isolado em `src/integrations/omie`,
ver `omie-api-mapping.md`). Definidos como referência para a Fase 3+; os
schemas Zod exatos serão implementados junto com cada módulo, não antes.

## 1. Convenções gerais

- Server Actions para mutações iniciadas por formulário (retornam
  `{ ok: true, data }` ou `{ ok: false, error: { code, message, fieldErrors? } }`
  — nunca lançam exceção não tratada para o cliente, nunca vazam stack trace).
  `code` vem de um enum de erro de domínio próprio (não o `OmieIntegrationErrorCode`
  cru — este é traduzido para uma mensagem de negócio antes de chegar à UI).
- Route Handlers REST-like para leitura paginada usada por TanStack Query
  (`GET /api/products?query=&page=&pageSize=`) e para os fluxos que exigem
  contrato HTTP estável (webhook, SSE, health).
- Toda resposta paginada usa o mesmo envelope interno, independente de como a
  Omie pagina cada serviço:
```ts
interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}
```

## 2. Produtos

- `GET /api/products?query=&familyId=&page=&pageSize=` → `Page<ProductSummaryDTO>`
- `GET /api/products/:id` → `ProductDetailDTO` (inclui estoque resumido e preço
  já resolvido pela precedência de tabela do usuário atual — nunca preço bruto
  de tabela sem aplicar a regra de precedência)
- `ProductSummaryDTO`: `{ id, sku, description, unit, imageUrl, price,
  availableStock, syncStatus, lastSyncAt }` — campos de custo/físico/reservado
  presentes **apenas** se o usuário tiver a permissão correspondente
  (serialização condicional no servidor).

## 3. Estoque

- `GET /api/products/:id/stock?warehouseId=` → `StockPositionDTO` com
  `physical?, reserved?, pending?, available, minStock?, lastSyncAt,
  isStale (boolean, calculado a partir de staleAfter)`. Campos opcionais só
  aparecem conforme permissão.
- `POST /api/products/:id/stock/refresh` (Server Action) → força revalidação
  síncrona contra a Omie (usado antes de confirmar pedido), sem passar pelo
  cache Redis.

## 4. Clientes

- `GET /api/customers?query=&page=&pageSize=` → `Page<CustomerSummaryDTO>`
  (escopo automático `read_own`/`read_all`)
- `POST customers.create` (Server Action) → valida CPF/CNPJ, normaliza
  telefone/CEP/endereço, checa duplicidade local por documento antes de
  chamar Omie, retorna `CustomerDTO` com `syncStatus`.
- `POST customers.update` (Server Action) → mesma validação; documento não é
  editável após `syncStatus != LOCAL_ONLY`.

## 5. Orçamentos e Pedidos

- `POST quotes.create` (Server Action) → recebe carrinho (itens, cliente,
  condição de pagamento, observações); backend recalcula preço/desconto/
  totais do zero (nunca confia nos totais enviados), valida limites de
  desconto, cria `Quote` em `DRAFT`.
- `POST quotes.submit` (Server Action) → gera/reusa `integrationCode`,
  revalida cliente/vendedor/preço/estoque, envia à Omie (`etapa: "00"`),
  atualiza `syncStatus`.
- `POST quotes.convert` (Server Action) → `TrocarEtapaPedido` para a etapa de
  pedido confirmado configurada na organização; cria/atualiza `Order` vinculado
  (`convertedFromQuoteId`).
- `POST orders.create` (Server Action) → mesmo pipeline de `quotes.submit`,
  mas já na etapa de pedido confirmado; protegido por `IdempotencyKey`
  (client gera UUID no primeiro clique) + lock distribuído + constraint única
  de banco em `integrationCode`.
- `GET /api/orders?status=&page=&pageSize=` / `GET /api/quotes?...` → listagens
  com escopo `read_own`/`read_all`.
- `GET /api/orders/:id/history` → histórico de status/tentativas de
  sincronização (`IntegrationAttempt`, auditoria relacionada).

Todas as mutações acima seguem o pipeline descrito no briefing §15/§16:
validar → revalidar preço/estoque/cliente/pagamento → montar payload próprio
→ registrar tentativa → enviar → registrar resposta → atualizar status →
sincronizar produtos envolvidos.

## 6. Webhook (contrato de entrada, não de saída)

- `POST /api/webhooks/omie/:organizationId/:webhookSecretToken` → sempre
  responde `200` rapidamente após persistir o payload bruto (ver
  `synchronization-strategy.md` §2); nunca processa a sincronização completa
  de forma síncrona no handler.

## 7. Eventos em tempo real

- `GET /api/events` (SSE, `Content-Type: text/event-stream`) → stream de
  eventos `{ type, entityType, entityId, at }` (nunca o dado completo — o
  cliente reage refazendo a query correspondente via TanStack Query,
  garantindo que o dado exibido sempre passou pela mesma validação/serialização
  condicional por permissão que uma requisição normal).

## 8. Health/Ready

- `GET /api/health` → `{ status: "ok" | "degraded" | "down" }` (sem detalhe
  sensível).
- `GET /api/ready` → idem, verificando conectividade com Postgres/Redis (não
  faz chamada à Omie síncrona para não acoplar disponibilidade do app à
  disponibilidade momentânea do ERP externo).
