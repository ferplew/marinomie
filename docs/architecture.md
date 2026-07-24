# Arquitetura — Plataforma Comercial Integrada ao Omie

Ver `docs/omie-api-mapping.md` para o que é fato confirmado sobre a Omie e o que
ainda depende de validação. Este documento assume esses fatos como premissa.

## 1. Visão geral

A plataforma é uma **camada comercial de OMS** entre vendedores e o Omie ERP.
O Omie continua sendo a fonte oficial dos dados empresariais; a aplicação mantém
uma base local otimizada para autenticação, permissões, pesquisa rápida, filas,
cache e auditoria — nunca uma cópia descontrolada do ERP.

```
                     ┌─────────────────────────────────────────────┐
                     │                Navegador (PWA)               │
                     │   Next.js App Router · React · Tailwind      │
                     │   shadcn/ui · React Hook Form + Zod          │
                     │   TanStack Query (estado de servidor)        │
                     └───────────────┬───────────────────────────────┘
                                     │ HTTPS (mesma origem)
                                     ▼
        ┌───────────────────────────────────────────────────────────────┐
        │                     Next.js Server (App)                      │
        │  ┌───────────────┐  ┌────────────────┐  ┌───────────────────┐ │
        │  │ Server Actions │  │ Route Handlers │  │  Auth (Better     │ │
        │  │ (mutações de   │  │ (/api/*, REST  │  │  Auth / Auth.js)  │ │
        │  │  domínio)      │  │  interno, SSE, │  │  sessão, RBAC     │ │
        │  │                │  │  webhooks)     │  │                   │ │
        │  └───────┬────────┘  └───────┬────────┘  └──────────┬────────┘ │
        │          │                   │                       │         │
        │          ▼                   ▼                       ▼         │
        │  ┌─────────────────────────────────────────────────────────┐  │
        │  │           Camada de Domínio / Casos de Uso               │  │
        │  │  products · inventory · customers · pricing ·            │  │
        │  │  quotes · orders · permissions · audit                   │  │
        │  └───────────┬─────────────────────────┬─────────────────────┘  │
        │              │                         │                       │
        │              ▼                         ▼                       │
        │  ┌───────────────────────┐   ┌─────────────────────────────┐  │
        │  │ Prisma / PostgreSQL    │   │ src/integrations/omie/       │  │
        │  │ (base local)           │   │  client · services · mappers │  │
        │  └───────────────────────┘   │  · schemas · errors · webhooks│  │
        │              ▲                └──────────────┬───────────────┘  │
        │              │                                │                 │
        │  ┌───────────┴────────────┐                   │ HTTPS (server-  │
        │  │ Redis                  │                   │ only, app_key/  │
        │  │ cache · locks ·        │                   │ app_secret nunca│
        │  │ filas (BullMQ)         │                   │ chegam ao       │
        │  └───────────┬────────────┘                   │ navegador)      │
        └──────────────┼────────────────────────────────┼─────────────────┘
                        │                                ▼
                        │                        ┌───────────────┐
                        ▼                        │   Omie ERP     │
        ┌───────────────────────────────┐        │  (fonte oficial)│
        │ Workers (processo separado,   │◄───────┤  Webhooks →     │
        │ mesmo repositório)            │        │  endpoint próprio│
        │ BullMQ consumers:              │        └───────────────┘
        │  products-sync · inventory-   │
        │  sync · customers-sync ·      │
        │  quotes-sync · orders-sync ·  │
        │  webhook-processing ·         │
        │  reconciliation · dead-letter │
        └────────────────────────────────┘
```

## 2. Fronteiras de responsabilidade

| Camada | Responsabilidade | Nunca faz |
|---|---|---|
| Frontend (React/Client Components) | Renderização, formulários, otimismo de UI, chamadas a Server Actions/Route Handlers próprios | Nunca chama a Omie diretamente; nunca guarda `app_secret`; nunca decide preço/desconto final; nunca decide permissão (só esconde/mostra botão como UX, não como controle) |
| Server Actions / Route Handlers | Validação Zod de entrada, autorização (RBAC + escopo de organização), orquestração de casos de uso, leitura/escrita no Postgres, enfileiramento de jobs | Nunca contém regra de negócio duplicada da Omie (não reimplementa cálculo fiscal); nunca chama `fetch` cru para a Omie — sempre via `src/integrations/omie` |
| `src/integrations/omie` | Único ponto de contato HTTP com a Omie: client tipado, retry/backoff/jitter, rate limiting (240 req/min), normalização de erro, mappers Omie→domínio | Nunca expõe o formato bruto da Omie para fora da pasta; nunca é importado por Client Components |
| Workers (BullMQ) | Sincronização assíncrona, processamento de webhook, reconciliação periódica, dead-letter | Nunca recebem credenciais completas no payload do job — apenas `organizationId` (o worker busca a credencial criptografada no banco) |
| PostgreSQL (Prisma) | Estado transacional local: usuários, permissões, sessões, auditoria, rascunhos, cache estruturado de catálogo/estoque/preço, status de sincronização | Nunca é tratado como cópia autoritativa da Omie para dados mestres — sempre tem `syncStatus`/`lastSyncAt` visível |
| Redis | Cache de leitura (TTL curto), locks distribuídos (idempotência, anti-duplo-clique), filas BullMQ | Nunca é a única fonte para confirmar uma venda crítica (estoque, preço) |

## 3. Por que Next.js App Router com Server Actions + Route Handlers separados

- **Server Actions**: mutações de domínio iniciadas por formulários/UI (criar orçamento, converter em pedido, cadastrar cliente) — colocated com a tela, mas sempre chamando a mesma camada de casos de uso que os Route Handlers usam (nenhuma lógica duplicada).
- **Route Handlers** (`/api/*`): (a) endpoints que precisam de contrato HTTP estável — webhook da Omie, health checks, SSE de atualização em tempo real; (b) chamadas de TanStack Query no cliente que precisam de GET cacheável (listagem paginada de produtos/estoque).
- Nenhuma delas nunca importa `src/integrations/omie/client` diretamente sem passar pela camada de serviço/domínio — isso é o que garante DTOs próprios e nunca vazamento do formato Omie.

## 4. Atualização quase em tempo real

Escolha: **Server-Sent Events (SSE)** via um Route Handler `/api/events` que lê um canal Redis Pub/Sub (`org:{organizationId}:events`) alimentado pelos workers ao concluir um job relevante (webhook processado, pedido confirmado/falho, estoque atualizado, aprovação realizada). SSE foi escolhido em vez de WebSockets porque:
- é unidirecional (a UI só precisa *ouvir* eventos, nunca falar de volta pelo mesmo canal — mutações continuam via Server Action/Route Handler comum);
- funciona sobre HTTP puro, simplificando deploy atrás de proxies/load balancers que já lidamos no Next.js;
- degrada graciosamente para polling (TanStack Query com `refetchInterval`) se SSE cair, sem exigir infraestrutura adicional (ex.: Pusher/Ably) na v1.

**Alternativa descartada:** WebSockets dedicado — complexidade extra de infraestrutura (sticky sessions) sem necessidade de comunicação bidirecional em tempo real. Pode ser revisitado se o produto crescer para colaboração multi-usuário simultânea na mesma tela.

## 5. Multiempresa desde o início

Toda tabela com dado de negócio carrega `organizationId`. Toda query do Prisma passa por um wrapper de repositório que **exige** `organizationId` como primeiro parâmetro (nunca opcional) — detalhado em `docs/security.md`. Credenciais Omie (`OmieCredential`) vivem por organização, criptografadas em repouso com `ENCRYPTION_KEY` (AES-256-GCM), nunca em variável de ambiente global em produção (variável global só é usada em desenvolvimento local via `OMIE_MOCK_MODE`).

## 6. Estrutura de pastas proposta (Fase 3 em diante)

```
src/
├── app/                          # Next.js App Router
│   ├── (auth)/                   # login, recuperação de senha
│   ├── (dashboard)/              # área autenticada do vendedor
│   │   ├── produtos/
│   │   ├── estoque/
│   │   ├── clientes/
│   │   ├── orcamentos/
│   │   ├── pedidos/
│   │   └── perfil/
│   ├── (admin)/                  # painel administrativo
│   │   ├── usuarios/
│   │   ├── vendedores/
│   │   ├── integracoes/
│   │   ├── sincronizacoes/
│   │   ├── webhooks/
│   │   └── auditoria/
│   └── api/
│       ├── webhooks/omie/[organizationId]/route.ts
│       ├── events/route.ts       # SSE
│       ├── health/route.ts
│       └── ready/route.ts
├── domain/                       # casos de uso puros (sem framework)
│   ├── products/
│   ├── inventory/
│   ├── customers/
│   ├── pricing/
│   ├── quotes/
│   ├── orders/
│   └── permissions/
├── integrations/omie/            # ver seção 5 do briefing original
├── server/
│   ├── auth/
│   ├── db/ (Prisma client singleton)
│   ├── cache/ (wrapper Redis)
│   └── queue/ (BullMQ setup, filas nomeadas)
├── workers/                      # processo separado (mesma imagem, entrypoint distinto)
└── lib/                          # utilidades genéricas (validação, formatação)
```

## 7. Processo Next.js vs. Workers

Em desenvolvimento (Docker Compose), o worker roda como **serviço separado** do mesmo código-fonte (`node src/workers/index.ts`), nunca dentro do processo do servidor Next.js — isso evita que jobs de longa duração bloqueiem requisições HTTP e permite escalar independentemente (mais réplicas de worker sem replicar o Next.js, e vice-versa).

## 8. Riscos arquiteturais identificados

| Risco | Mitigação |
|---|---|
| Rate limit de 240 req/min da Omie compartilhado entre sync em background e ações de vendedor em tempo real | Fila prioritária: jobs de ação do usuário (revalidar estoque/preço antes de confirmar pedido) têm prioridade sobre sync em massa; limitador de taxa central no client Omie compartilhado por todos os workers de uma organização |
| Webhook sem assinatura confirmada publicamente | Endpoint por organização com token não-adivinhável na URL + tratamento do payload como gatilho, nunca como verdade (revalidação via API antes de aplicar) |
| Falta de garantia de reserva de estoque no Omie para pedidos pendentes | Nunca prometer "sem overselling" na UI; sempre revalidar estoque no backend imediatamente antes de `IncluirPedido`, e aceitar que pode haver conflito pós-fato, tratado como `CONFLICT` sync status |
| Escalonamento de custo de chamadas (catálogo grande) | Cache Redis + paginação obrigatória + sync incremental por data de alteração, nunca full-scan no caminho de leitura do vendedor |

## 9. Decisões de versão tomadas na implementação (Fase 3)

Detalhes que só apareceram ao escrever o código e que valem registro porque
mudam onde as coisas ficam:

| Item | Decisão | Motivo |
|---|---|---|
| Prisma 7 | URL do banco em `prisma.config.ts` + driver adapter (`@prisma/adapter-pg`) no `PrismaClient` | O Prisma 7 removeu `url = env(...)` do `schema.prisma`; a conexão em runtime passa pelo adapter |
| IDs do Better Auth | `advanced.database.generateId: "uuid"` | Sem isso o Better Auth gera IDs alfanuméricos próprios, incompatíveis com as colunas `@db.Uuid` do schema |
| Middleware | Arquivo `src/proxy.ts` (convenção `proxy` do Next 16) | `middleware.ts` está deprecado no Next 16 |
| Negação de acesso | `experimental.authInterrupts` + `forbidden()`/`unauthorized()` com `app/forbidden.tsx` e `app/unauthorized.tsx` | Sem isso, falta de permissão lançada numa página virava **HTTP 500**; agora devolve 403/401 reais |
| Duas famílias de guarda | `requirePermission`/`requireAnyPermission` (páginas, interrompem com 403/401) vs. `assertPermission`/`assertReadScope` (domínio, lançam `AppError`) | Páginas precisam de status HTTP; Server Actions precisam de erro convertível em `ActionResult` |
| Rotas tipadas | `typedRoutes: true` | Um `href` para rota inexistente vira erro de compilação |
| Lint | `eslint .` direto, flat config | `next lint` foi removido no Next 16 |

## 10. Alternativas descartadas

- **tRPC no lugar de Server Actions/Route Handlers**: descartado para reduzir dependências na v1; Server Actions do Next.js já cobrem a necessidade de RPC tipado ponta a ponta.
- **Prisma substituído por Drizzle**: Prisma escolhido por maturidade de migrations, ecossistema e familiaridade — decisão reversível se performance de queries N+1 se tornar problema.
- **Kafka no lugar de BullMQ/Redis**: complexidade operacional desnecessária no volume esperado (vendedores de uma empresa, não milhões de eventos/dia); BullMQ sobre Redis já cobre fila + retry + dead-letter.
