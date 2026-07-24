# Permissões

RBAC com catálogo de permissões granulares por `RolePermission`, avaliado
sempre no servidor (ver `security.md` §2/§3). Perfis padrão são um ponto de
partida do seed, não um limite rígido — administradores podem compor papéis
customizados a partir do catálogo de permissões.

## 1. Perfis padrão

| Perfil | Escopo típico |
|---|---|
| `SUPER_ADMIN` | Multi-organização: cria organizações, acessa integrações e falhas globais |
| `ADMIN` | Organização inteira: usuários, vendedores, integração Omie, todos os clientes/pedidos, relatórios, reprocessamento |
| `GERENTE_COMERCIAL` | Equipe: clientes/pedidos/orçamentos da equipe, aprovação de desconto, acompanhamento de metas |
| `VENDEDOR` | Próprio: catálogo, estoque/preço permitidos, clientes permitidos, cria orçamento/pedido, acompanha os próprios |
| `CONSULTA` | Somente leitura de produtos/preços/estoques autorizados |

## 2. Catálogo de permissões granulares

```
users.read
users.create
users.update
users.disable
products.read
products.view_cost
products.view_physical_stock
products.view_reserved_stock
customers.read_all
customers.read_own
customers.create
customers.update
quotes.create
quotes.read_all
quotes.read_own
quotes.update
quotes.cancel
quotes.convert
orders.create
orders.read_all
orders.read_own
orders.update
orders.cancel
discounts.apply
discounts.approve
prices.override
integrations.read
integrations.configure
integrations.sync
integrations.retry
audit.read
reports.read
```

Cada permissão é checada no ponto de entrada do caso de uso (Server
Action/Route Handler), nunca inferida por perfil no frontend. `*_own` vs
`*_all`: quando o usuário tem apenas `_own`, a query é automaticamente
filtrada por `sellerLinkId`/`ownerSellerId` do usuário autenticado — o filtro é
aplicado na camada de repositório, não como pós-filtro em memória (evita
vazamento acidental por bug de UI).

## 3. Regras específicas de negócio

- **Vendedor criando pedido em nome de outro vendedor**: requer `ADMIN` (ou
  permissão dedicada futura `orders.create_on_behalf`) — a UI só oferece a
  opção quando a permissão existe; o backend recusa mesmo que a requisição seja
  forjada. Toda ocorrência é auditada com o vendedor "ator" e o vendedor "em
  nome de quem".
- **Aplicar desconto**: `discounts.apply` permite solicitar desconto até
  `SellerLink.maxDiscountPercent` **e** até `nDescMaximo` da tabela de preço
  Omie (o menor dos dois prevalece — ver `omie-api-mapping.md` §7). Acima
  disso, a ação vira `ApprovalRequest` e exige `discounts.approve` (tipicamente
  `GERENTE_COMERCIAL`/`ADMIN`) antes do orçamento/pedido poder ser enviado.
- **`prices.override`**: permissão excepcional (tipicamente só `ADMIN`) para
  sobrescrever o preço de tabela — sempre registrada em auditoria com preço
  original e preço final.
- **`products.view_cost` / `products.view_physical_stock` /
  `products.view_reserved_stock`**: controlam campos, não telas inteiras — a
  mesma tela de produto omite os campos que o usuário não tem permissão de ver,
  aplicado na serialização do backend (o campo simplesmente não é enviado ao
  cliente, não é só ocultado via CSS).
- **`integrations.*`**: exclusivo de `ADMIN`/`SUPER_ADMIN`. `integrations.sync`
  dispara sync manual; `integrations.retry` reprocessa jobs falhos/dead-letter.
- **Campos que o vendedor nunca altera no frontend** (reforço do briefing
  §10), reconstruídos e validados sempre no backend: código de vendedor
  vinculado, organização, tabela de preço autorizada, limite máximo de
  desconto, custo dos produtos, regras fiscais, status interno da integração.

## 4. Aplicação técnica

Middleware único `requirePermission(permissionKey, { scope？})` usado em todo
caso de uso de `src/domain/*`, chamado a partir de Server Actions e Route
Handlers — nunca duplicado ad-hoc por tela. Testes de permissão fazem parte do
critério de aceite de cada módulo (ver `development-roadmap.md`): para cada
caso de uso, existe pelo menos um teste que confirma que um usuário sem a
permissão correspondente recebe 403/erro de domínio, não apenas UI escondida.
