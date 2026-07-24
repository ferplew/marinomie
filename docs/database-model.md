# Modelo de Dados

Modelo conceitual (Prisma será a implementação na Fase 3). Todas as entidades de
negócio carregam `organizationId` (isolamento multiempresa). IDs locais são UUID.
Valores monetários e quantidades usam `Decimal`, nunca `Float`.

Para cada entidade: **Fonte oficial** (quem manda no dado), **Armazenado
localmente** (persistido no Postgres), **Apenas cache** (Redis, TTL, pode sumir),
**Alterável pelo app** (o quê o app pode escrever sem confirmação Omie) e
**Confirmação obrigatória no Omie** (o que só é verdade após resposta da Omie).

## 1. Organização e configuração

### Organization
- Fonte oficial: aplicação (não existe no Omie).
- Armazenado localmente: `id`, `name`, `document`, `active`, `createdAt`, `updatedAt`.
- Cache: não.
- Alterável pelo app: tudo (entidade de controle interno).
- Confirmação Omie: nenhuma.

### OrganizationSettings
- Campos: `organizationId`, `availableStockRule` (enum `AvailableStockRule`), `stockSafetyMargin` (Decimal), `priceTablePrecedence` (JSON ordenado — cliente/vendedor/organização/padrão), `defaultQuoteEtapa` (default `"00"`, ver mapping), `defaultConfirmedEtapa` (default `"10"`, configurável por organização — ver seção 3 do mapping), `reconciliationIntervals` (JSON por domínio).
- 100% local, editável apenas por `ADMIN`/`SUPER_ADMIN`.

### OmieCredential
- Campos: `organizationId` (único), `appKeyEncrypted`, `appSecretEncrypted`, `webhookSecretToken`, `active`, `lastTestedAt`, `lastTestResult`.
- Fonte oficial: aplicação armazena; valores vêm do portal do desenvolvedor Omie.
- Criptografado em repouso com `ENCRYPTION_KEY` (AES-256-GCM). Nunca logado, nunca serializado para o cliente — nem mascarado parcialmente na API pública (o painel admin mostra só os últimos 4 caracteres).

## 2. Identidade e permissões

### User
- Campos: `id`, `organizationId`, `email`, `passwordHash` (ou vínculo com provider de auth), `name`, `active`, `failedLoginCount`, `lockedUntil`, `mfaEnabled`, `createdAt`, `updatedAt`.
- Fonte oficial: aplicação. Não existe no Omie (Omie tem "vendedor", que é uma entidade de negócio diferente de "usuário do sistema").

### Role / Permission / UserRole
- RBAC clássico: `Role(id, organizationId, name)`, `Permission(id, key)` (catálogo fixo — lista da seção "Permissões granulares" do briefing), `UserRole(userId, roleId)`, `RolePermission(roleId, permissionId)`.
- Perfis padrão (seed): `SUPER_ADMIN`, `ADMIN`, `GERENTE_COMERCIAL`, `VENDEDOR`, `CONSULTA` — granularidade adicional via `RolePermission` permite customização por organização sem mudar código.

### SellerLink
- Campos: `id`, `organizationId`, `userId` (único por organização), `omieSellerId`, `omieSellerCode`, `displayName`, `active`, `defaultPriceTableId`, `maxDiscountPercent`, `createdAt`, `updatedAt`.
- Fonte oficial do vínculo: aplicação (é uma decisão de negócio local, o Omie não sabe qual usuário do nosso sistema corresponde a qual vendedor). `omieSellerId`/`omieSellerCode` são espelho do cadastro Omie (`ListarVendedores`).
- `defaultPriceTableId`/`maxDiscountPercent`: **confirmado na pesquisa de API que não existem no Omie** — são exclusivamente locais (ver `omie-api-mapping.md` seção 6).
- Alterável pelo app: tudo exceto o vínculo `omieSellerId` sem permissão de `ADMIN`.

## 3. Catálogo (cache local do Omie)

### Product
- Fonte oficial: Omie (`ProdutoServico`).
- Armazenado localmente: cache estruturado — `id`, `organizationId`, `omieId`, `integrationCode`, `sku`, `description`, `unit`, `ncm`, `familyId`, `active`, `basePrice` (Decimal), `imageUrl`, `syncStatus`, `lastSyncAt`, `version`.
- Cache adicional (Redis): resultado de busca paginada, TTL 5–30 min.
- Alterável pelo app: nenhum campo de negócio — só `favoritedBy` (relação local de favoritos) e metadados de exibição.
- Confirmação obrigatória no Omie: preço final e existência do produto são sempre revalidados antes de confirmar um pedido (nunca confiar só no cache local nesse momento).

### ProductFamily
- Cache local espelhando famílias/categorias do Omie, TTL longo (1–24h).

### PriceTable / PriceTableItem
- Fonte oficial: Omie (`TabelaPrecos`).
- Local: cache de `nCodTabPreco`, `descricao`, `ativa`; `PriceTableItem` cacheia `nValorTabela`, `nDescMaximo` por produto, TTL 5–15 min.
- Confirmação obrigatória: preço e desconto máximo são sempre revalidados no backend no momento de orçamento/pedido, nunca aceitos do payload do navegador.

## 4. Estoque (visibilidade, não WMS completo)

### Warehouse (Local de Estoque)
- Fonte oficial: Omie (`LocalEstoque`).
- Local: cache de `codigo_local_estoque`, `codigo`, `descricao`, `dispVenda`, TTL longo.

### InventoryPosition
- Fonte oficial: Omie (`ConsultaEstoque`/`ResumoEstoque`).
- Local: `productId`, `warehouseId`, `physical`, `reserved`, `pending`, `available` (calculado conforme `AvailableStockRule` da organização, ou `nDisponivel` direto se `OMIE_CALCULATED`), `minStock`, `lastSyncAt`, `staleAfter`.
- **Nunca fonte única para confirmar venda** — sempre revalidado (leitura direta à Omie, sem cache) imediatamente antes de `IncluirPedido`.
- TTL de cache Redis: 15–60s conforme item 21 do briefing.

### InventoryMovement
- Histórico local apenas de auditoria/exibição (espelha `MovEstoque`/`ListarMovimentoEstoque`), não é fonte de decisão — usado só para a tela "histórico de atualização" (visibilidade WMS da v1).

## 5. Clientes

### Customer
- Fonte oficial: Omie (`ClientesCadastro`), com exceção de rascunhos.
- Local: `id`, `organizationId`, `omieId`, `integrationCode` (= `codigo_cliente_integracao`), `document` (CPF/CNPJ normalizado), `legalName`, `tradeName`, `email`, `defaultPriceTableId` (local, decisão de negócio — ver ponto em aberto na seção 7 do mapping), `syncStatus`, `ownerSellerId` (para `customers.read_own`), `createdAt`, `updatedAt`.
- Rascunho de cliente novo (antes de enviar) vive local com `syncStatus = LOCAL_ONLY`; após `UpsertClienteCpfCnpj`/`IncluirCliente` bem-sucedido, `omieId` é preenchido e o registro passa a ser considerado espelho, não mais fonte.
- Alterável pelo app: dados de contato/endereço podem ser editados localmente e reenviados (`AlterarCliente`); documento (CPF/CNPJ) não é editável após sincronizado (mudar documento é criar novo cliente).

### CustomerAddress
- Local, normalizado (CEP/endereço), espelha estrutura de endereço da Omie quando sincronizado.

## 6. Vendas

### Quote (Orçamento)
- Fonte oficial: aplicação até o envio; depois, o par (aplicação + Omie) — Omie é a verdade sobre o registro (`etapa = "00"`), a aplicação é a verdade sobre o *fluxo comercial local* (aprovação interna antes de enviar, por exemplo).
- Campos: `id`, `organizationId`, `localNumber`, `integrationCode` (= `codigo_pedido_integracao`, gerado uma única vez, nunca regenerado em retry), `omieId` (= `numero_pedido`), `sellerLinkId`, `customerId`, `subtotal`, `discountTotal`, `shipping`, `otherCosts`, `total` (todos Decimal), `paymentTermId`, `expectedDate`, `validUntil`, `notes`, `status` (enum local `QuoteStatus`), `syncStatus`, `lastSyncAt`, `lastSyncError`, `version`, `createdAt`, `updatedAt`.
- `QuoteStatus`: `DRAFT, PENDING_APPROVAL, APPROVED, REJECTED, SYNC_PENDING, SYNCING, SYNCED, SYNC_FAILED, EXPIRED, CONVERTED, CANCELLED` (igual ao briefing).
- Confirmação obrigatória no Omie: total e itens só são considerados definitivos após `SYNCED`.

### QuoteItem
- `quoteId`, `productId`, `quantity`, `unitPrice`, `originalUnitPrice` (antes do desconto), `discountPercent`, `discountApprovedBy` (nullable), `priceTableId`.

### Order (Pedido) — **desenho revisado na implementação**

A implementação **não** criou duas tabelas. Como no Omie orçamento e pedido são
o mesmo registro (`PedidoVendaProduto`, diferenciado por `etapa`), duas tabelas
locais fariam um único registro do ERP corresponder a duas linhas nossas, que
poderiam divergir — e a conversão viraria uma cópia de dados em vez do que
realmente acontece, que é `TrocarEtapaPedido` sobre o mesmo `codigo_pedido`.

O que existe é **uma** entidade `SalesDocument` com discriminador
`kind: QUOTE | ORDER`, preservando `omieId`, `omieNumber` e `integrationCode` na
conversão. `SalesDocumentItem` substitui `QuoteItem`/`OrderItem`. As telas de
"Orçamentos" e "Pedidos" são a mesma consulta com filtro diferente.

Campos relevantes: `kind`, `status` (enum local), `localNumber`,
`integrationCode`, `omieId`, `omieNumber`, `omieStage`, `sellerLinkId`,
`createdByUserId` (preenchido quando um admin cria em nome de outro vendedor),
`customerId`, totais em `Decimal`, e os campos de sincronização da seção 9.

### IntegrationAttempt
- Log de cada tentativa de chamada de escrita à Omie (Incluir/Alterar/TrocarEtapa) para `Quote`/`Order`/`Customer`: `id`, `organizationId`, `entityType`, `entityId`, `idempotencyKey`, `requestPayloadHash` (não o payload completo com dado sensível, só hash + campos não sensíveis), `responseStatus`, `omieCode`, `omieDescription`, `attemptNumber`, `createdAt`. Essencial para a estratégia "consultar antes de repetir" (seção 9 do mapping).

## 7. Sincronização e confiabilidade

### WebhookEvent
- `id`, `organizationId`, `topic` (nullable até schema confirmado — ver mapping seção 10), `rawPayload` (Json, **sempre** persistido antes de qualquer parsing), `receivedAt`, `processedAt`, `status` (`RECEIVED, PROCESSING, PROCESSED, FAILED, DUPLICATE`), `dedupeKey` (hash do payload + timestamp da Omie, quando disponível), `sourceIp`.

### SyncJob
- `id`, `organizationId`, `queue`, `entityType`, `idempotencyKey`, `attempts`, `correlationId`, `status`, `startedAt`, `finishedAt`, `totalFetched`, `totalChanged`, `cursor`, `nextRunAt`, `error`.

### AuditLog
- Conforme seção 25 do briefing, campo a campo. `beforeData`/`afterData` armazenam JSON com dados sensíveis mascarados (nunca senha, nunca `app_secret`).

### IdempotencyKey
- `key` (PK, composto: `organizationId + scope + key`), `entityType`, `entityId`, `result` (Json, resposta cacheada), `createdAt`, `expiresAt`. Usado tanto para o botão "criar pedido" (evitar duplo clique) quanto para chamadas de escrita à Omie.

### ApprovalRequest / Notification
- `ApprovalRequest`: aprovação de desconto acima do limite do vendedor — `id`, `organizationId`, `quoteId`/`orderId`, `requestedBy`, `approvedBy` (nullable), `status`, `reason`.
- `Notification`: notificações locais (pedido confirmado, falha de sync, aprovação pendente) — `id`, `organizationId`, `userId`, `type`, `payload`, `readAt`.

## 8. Constraints e índices importantes

- `Product(organizationId, integrationCode)` único.
- `Customer(organizationId, integrationCode)` único; `Customer(organizationId, document)` único.
- `Quote`/`Order`: `(organizationId, integrationCode)` único — nunca duplicar em retry.
- `SellerLink(organizationId, userId)` único; `SellerLink(organizationId, omieSellerId)` único.
- `WebhookEvent(organizationId, dedupeKey)` único (proteção contra evento duplicado).
- Índices de busca: `Product(organizationId, sku)`, `Product(organizationId, description)` (trigram/GIN se necessário), `Customer(organizationId, document)`, `Customer(organizationId, legalName)`.
- Soft delete (`deletedAt`) em `Product`, `Customer`, `User` — nunca hard delete de entidades com histórico de venda vinculado.

## 9. Enum central de sincronização

```ts
type SyncStatus =
  | "LOCAL_ONLY"
  | "PENDING"
  | "PROCESSING"
  | "SYNCED"
  | "FAILED"
  | "CONFLICT"
  | "STALE";
```
Presente em `Product`, `Customer`, `Quote`, `Order`, `InventoryPosition`, com os campos auxiliares (`lastSyncAt`, `lastSyncAttemptAt`, `nextRetryAt`, `syncAttempts`, `lastSyncError`, `omieId`, `integrationCode`, `sourceUpdatedAt`, `localUpdatedAt`, `version`) descritos no briefing seção 17.
