# Roadmap de Desenvolvimento

Entregas pequenas e incrementais, cada uma com critério de aceite verificável
(lint + typecheck + testes + docs atualizadas), seguindo o processo obrigatório
do briefing §4/§38. Nenhuma fase começa sem a anterior estar com critério de
aceite cumprido.

## Fase 1 — Descoberta ✅ (esta entrega)
- `docs/omie-api-mapping.md` com endpoints/métodos reais e lacunas explícitas.

## Fase 2 — Arquitetura ✅ (esta entrega)
- `docs/architecture.md`, `docs/database-model.md`,
  `docs/synchronization-strategy.md`, `docs/security.md`, `docs/permissions.md`,
  `docs/api-contracts.md`, `docs/development-roadmap.md` (este arquivo).

## Fase 3 — Fundação
1. Estrutura do projeto Next.js (TypeScript estrito), Tailwind, shadcn/ui.
2. `docker-compose.yml` (Postgres, Redis, app, worker), `.env.example`.
3. Prisma schema inicial (entidades de identidade/permissão/organização —
   ainda sem catálogo/vendas) + migration inicial.
4. Autenticação (Better Auth) com sessão, bloqueio de conta, recuperação de
   senha; RBAC básico (`Role`/`Permission`/`UserRole`) e middleware
   `requirePermission`.
5. Layout principal (mobile-first) + painel administrativo básico (só shell,
   sem dados reais ainda).
6. Logs estruturados, tratamento global de erro, `/api/health`, `/api/ready`.
7. Seed mínimo (uma organização, um `SUPER_ADMIN`, um `ADMIN`).
8. Testes iniciais: auth, RBAC, isolamento multiempresa.

**Critério de aceite:** administrador consegue logar, ver o shell do painel,
health/ready respondem, testes de auth/RBAC/isolamento passam.

## Fase 4 — Integração Omie (client isolado)
1. `src/integrations/omie/client` — request builder (`call/app_key/app_secret/param`),
   rate limiter (240 req/min), retry+backoff+jitter, normalização de erro
   (`OmieIntegrationError`), mascaramento de log, `OMIE_MOCK_MODE`.
2. `OmieCredential` (CRUD + criptografia) e tela admin de "testar conexão".
3. Serviços isolados por domínio (`products`, `inventory`, `customers`,
   `sellers`, `price-tables`) — cada um implementado **só depois** de
   confirmar o item correspondente do mapping que ainda estiver em aberto.
4. Mock da Omie (fixtures baseadas nos payloads documentados) usado nos testes
   e em `OMIE_MOCK_MODE=true` para demo sem API real.

**Critério de aceite:** client isolado testado (unit + integração com mock),
nenhuma credencial exposta em log, "testar conexão" funcional no admin.

## Fase 5 — Módulos comerciais
1. Produtos: listagem paginada, busca, detalhe, favoritos/recentes.
2. Estoque: exibição por permissão, indicador de última sincronização/stale.
3. Clientes: busca, cadastro (validação CPF/CNPJ, dedupe), edição, histórico.
4. Tabelas de preço e regra de precedência + validação de desconto no backend.
5. Orçamentos: fluxo rápido de venda (cliente → produto → carrinho → revisão →
   salvar/enviar), idempotência de envio.
6. Pedidos: conversão de orçamento, criação direta, acompanhamento de status.

**Critério de aceite:** um orçamento pode ser criado, salvo e enviado (se a
API suportar o fluxo confirmado em `omie-api-mapping.md` §3); um pedido pode
ser criado sem duplicidade sob clique duplo (teste automatizado dedicado).

## Fase 6 — Sincronização e confiabilidade
1. Filas BullMQ (`omie-products-sync`, `omie-inventory-sync`,
   `omie-customers-sync`, `omie-quotes-sync`, `omie-orders-sync`,
   `omie-webhook-processing`, `omie-reconciliation`, `omie-dead-letter`).
2. Endpoint de webhook + handler genérico + persistência de payload bruto.
3. Reconciliação periódica configurável por domínio.
4. Painel de integração completo (§30 do briefing): status, últimas
   sincronizações, jobs pendentes/falhos, webhooks recebidos/duplicados,
   ações de sincronizar/reprocessar/pausar.
5. Auditoria completa (todas as ações listadas no briefing §25).

**Critério de aceite:** falha simulada de rede é reprocessada com sucesso via
painel admin; evento de webhook duplicado é identificado e não reprocessado;
reconciliação corrige uma divergência simulada.

## Fase 7 — Testes e documentação final
1. Cobertura de testes unitários (mappers, validações, cálculos de desconto,
   permissões, classificação de erro, idempotência, regras de estoque).
2. Testes de integração (banco, Omie client mockado, filas, webhook, auth,
   autorização, criação de cliente/orçamento/pedido).
3. Testes E2E dos fluxos críticos do briefing §27.
4. `docs/known-limitations.md`, `docs/production-checklist.md`,
   `docs/omie-setup.md`, `docs/webhook-setup.md`, `docs/deployment.md`
   finalizados com limitações reais observadas (não hipotéticas).

**Critério de aceite:** critérios de aceite do briefing §36 cumpridos e
verificáveis por teste automatizado, não apenas por inspeção manual.

## Backlog explícito para expansão futura (fora do escopo desta entrega)
- WMS completo (endereçamento, picking/packing, ondas, romaneios, código de
  barras, inventário cíclico).
- Multiempresa com múltiplas organizações por usuário simultaneamente.
- Multi-idioma/multi-moeda.
- App mobile nativo (a v1 é PWA mobile-first, não nativo).

## Próximo passo imediato após esta entrega

Antes de iniciar a Fase 3, os itens da seção 12 de `omie-api-mapping.md`
(sobretudo a lista de tópicos de webhook e o momento exato de reserva de
estoque) precisam ser confirmados por alguém com acesso ao portal do
desenvolvedor Omie autenticado com o `app_key` real da empresa — isso não
bloqueia a Fase 3 (fundação não depende da Omie), mas bloqueia o início real
da Fase 6 (webhooks) e deve ser resolvido em paralelo à Fase 3/4.
