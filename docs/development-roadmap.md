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

## Fase 3 — Fundação ✅
1. ✅ Estrutura do projeto Next.js 16 (TypeScript estrito, `noUncheckedIndexedAccess`), Tailwind 4, primitivas no padrão shadcn/ui.
2. ✅ `docker-compose.yml` (Postgres 17, Redis 7, app), `Dockerfile.dev`, `.env.example`. O serviço de worker fica para a Fase 6, quando existirem filas.
3. ✅ Prisma 7: schema de organização/identidade/permissões/vínculo de vendedor/auditoria + migration inicial aplicada.
4. ✅ Autenticação Better Auth (sessão em banco, cadastro público desabilitado, CSRF por `Origin`) e RBAC com `requirePermission`/`requireAnyPermission` no servidor.
5. ✅ Layout mobile-first com barra inferior + painel administrativo com dados reais (usuários, vendedores, auditoria, estado da integração).
6. ✅ Logs estruturados com mascaramento, `error.tsx`/`not-found.tsx`/`forbidden.tsx`/`unauthorized.tsx`, `/api/health`, `/api/ready`.
7. ✅ Seed: organização, 5 perfis, 33 permissões, 4 usuários, 2 vínculos de vendedor.
8. ✅ 64 testes (permissões, escopo multiempresa, mascaramento, erros).

**Critério de aceite — cumprido e verificado** contra Postgres 16 e Redis 7
reais: migration e seed executam; login aceita a senha correta e recusa a
errada; permissões negadas devolvem **403** (não 500); auditoria de login e
logout grava IP e user-agent; duas organizações distintas não vazam dados uma
para a outra, nem quando compartilham o mesmo código de vendedor Omie;
`/api/health` e `/api/ready` respondem 200 com Postgres e Redis de pé.

**Dívidas registradas** em `docs/known-limitations.md` §4: incremento de
tentativas falhas de login, recuperação de senha, MFA, revogação de sessões pela
UI e CRUD de usuários/vendedores pela interface.

## Fase 4 — Integração Omie (client isolado) ✅
1. ✅ `src/integrations/omie/client` — request builder (`call/app_key/app_secret/param`),
   rate limiter (240 req/min, limite efetivo conservador por organização),
   retry + backoff exponencial + full jitter, timeout, circuit breaker por
   organização, normalização de erro (`OmieIntegrationError`), mascaramento de
   log, correlation ID, `OMIE_MOCK_MODE`.
2. ✅ `OmieCredential` cifrada em repouso (AES-256-GCM) com painel de
   configuração e ação de "testar conexão".
3. ✅ Serviços isolados: `products`, `inventory`, `customers`, `sellers`,
   `price-tables`, `connection`. `ListarTabelasPreco` foi deliberadamente
   **não implementado** porque o nome do array na resposta não pôde ser
   confirmado (docs/known-limitations.md).
4. ✅ Mock da Omie com fixtures que reproduzem a estrutura documentada de cada
   resposta, atrás da mesma interface de transporte do HTTP real.

**Critério de aceite — cumprido.** 124 testes novos (188 no total). Verificado
contra Postgres e Redis reais: credencial gravada cifrada (`v1:` + AES-256-GCM,
segredo ausente do banco em texto puro), decifrada corretamente, nenhum segredo
presente no HTML da página administrativa (só a dica dos 4 últimos dígitos),
teste de conexão executado ponta a ponta e persistido, limitador de taxa
bloqueando na janela real do Redis, e listagem de produtos com paginação.

Decisões de projeto verificadas por teste:
- **Escrita nunca é repetida automaticamente** (uma única tentativa); timeout ou
  HTTP 500 sem mensagem conhecida em escrita produz `UNCERTAIN_RESULT`, que
  obriga consulta pelo código de integração antes de qualquer reenvio.
- **Erro de validação não abre o circuito**: ele prova que a Omie está saudável.
- **O mapper não calcula estoque disponível**: repassa `nDisponivel` da Omie e os
  componentes brutos separadamente, deixando a fórmula para a regra configurável
  da organização.
- **Teto de desconto** é o menor entre o `nDescMaximo` da tabela Omie e o limite
  do vendedor.

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
