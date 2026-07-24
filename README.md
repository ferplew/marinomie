# marinomie

Plataforma comercial integrada ao **Omie ERP** — camada de OMS comercial para
vendedores internos e externos: catálogo, consulta de estoque, clientes,
orçamentos e pedidos, com sincronização confiável, auditoria e idempotência.

> **Estado atual: Fases 1 e 2 concluídas (descoberta + arquitetura).**
> Ainda não há código de aplicação neste repositório. Ver
> [`docs/development-roadmap.md`](docs/development-roadmap.md) para o que vem a seguir.

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
