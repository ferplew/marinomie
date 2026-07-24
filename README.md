# marinomie

Plataforma comercial integrada ao **Omie ERP** — camada de OMS comercial para
vendedores internos e externos: catálogo, consulta de estoque, clientes,
orçamentos e pedidos, com sincronização confiável, auditoria e idempotência.

> **Estado atual: Fases 1 a 4 concluídas + Fase 5 parcial** (descoberta, arquitetura, fundação,
> integração Omie e módulos comerciais de leitura/cadastro). Existem
> autenticação, RBAC no servidor, multiempresa, auditoria, painel
> administrativo, client de integração completo (rate limiter, retry com backoff
> e jitter, circuit breaker, modo mock, credenciais cifradas), **catálogo de
> produtos com busca, consulta de estoque com regra configurável e cadastro de
> clientes com validação de CPF/CNPJ e idempotência**.
> Inclui o fluxo de venda completo: orçamento com preço e desconto validados no
> servidor, envio ao Omie e conversão em pedido sem duplicar registro.
> **Faltam filas, webhooks e reconciliação automática** — Fase 6.
> Ver [`docs/development-roadmap.md`](docs/development-roadmap.md) e
> [`docs/known-limitations.md`](docs/known-limitations.md).

## Stack

Next.js 16 (App Router) · TypeScript estrito · Tailwind 4 · PostgreSQL 17 ·
Prisma 7 · Redis 7 · Better Auth · Zod · Vitest

## Rodando localmente

```bash
cp .env.example .env      # gere AUTH_SECRET e ENCRYPTION_KEY próprios
docker compose up -d      # Postgres + Redis + app
npm run db:migrate        # aplica a migration inicial
npm run db:seed           # organização, perfis e usuários de demonstração
```

A aplicação sobe em `http://localhost:3000`. Sem Docker, basta ter Postgres e
Redis acessíveis nas URLs do `.env` e rodar `npm run dev`.

Usuários criados pelo seed (senha `senha-de-desenvolvimento`, apenas
desenvolvimento — o seed se recusa a rodar com `NODE_ENV=production`):

| E-mail | Perfil |
|---|---|
| `admin@demo.local` | ADMIN |
| `gerente@demo.local` | GERENTE_COMERCIAL |
| `vendedor1@demo.local` | VENDEDOR (vinculado ao vendedor Omie 1001) |
| `vendedor2@demo.local` | VENDEDOR (vinculado ao vendedor Omie 1002) |

## Comandos

```bash
npm run check       # typecheck + lint + testes
npm run typecheck
npm run lint
npm run test
npm run build
npm run db:studio   # inspeção do banco
```

`OMIE_MOCK_MODE=true` (padrão) permite desenvolver e demonstrar sem credenciais
reais da Omie.

## Documentação

| Documento | Conteúdo |
|---|---|
| [`docs/omie-api-mapping.md`](docs/omie-api-mapping.md) | Endpoints, métodos e campos **reais** da API Omie, com fontes citadas e lacunas marcadas explicitamente |
| [`docs/architecture.md`](docs/architecture.md) | Arquitetura geral, fronteiras, decisões técnicas e alternativas descartadas |
| [`docs/database-model.md`](docs/database-model.md) | Modelo de dados, fonte de verdade por entidade, constraints e índices |
| [`docs/synchronization-strategy.md`](docs/synchronization-strategy.md) | Webhooks, filas, cache, reconciliação, idempotência |
| [`docs/security.md`](docs/security.md) | Autenticação, autorização, segredos, isolamento multiempresa, LGPD |
| [`docs/permissions.md`](docs/permissions.md) | Perfis, catálogo de permissões granulares e regras de negócio |
| [`docs/api-contracts.md`](docs/api-contracts.md) | Contratos internos entre frontend e backend |
| [`docs/development-roadmap.md`](docs/development-roadmap.md) | Plano incremental por fases com critérios de aceite |
| [`docs/known-limitations.md`](docs/known-limitations.md) | O que ainda não sabemos sobre a Omie e o que não pode ser garantido |

## Princípio inegociável

O Omie é a fonte oficial dos dados empresariais. A base local existe para
autenticação, permissões, cache, filas e auditoria — **não** para ser uma cópia
descontrolada do ERP. Nenhum endpoint, campo ou comportamento da Omie é
inventado: o que não foi confirmado na documentação oficial está marcado como
pendente em `docs/known-limitations.md`.
