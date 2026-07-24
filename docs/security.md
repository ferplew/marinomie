# Segurança

## 1. Autenticação

Solução escolhida e **implementada na Fase 3**: **Better Auth** (self-hosted, sem
dependência de serviço terceiro pago, suporta sessão segura, MFA, e é compatível
com Next.js App Router via handler nativo). Alternativa avaliada: Auth.js (mais
simples para OAuth social, mas gestão de sessão/senha própria menos madura para o
fluxo de bloqueio de conta e MFA exigidos aqui); Clerk (excelente DX, mas
dependência de serviço externo pago e dado de usuário fora do nosso banco, o que
complica auditoria/LGPD end-to-end e o isolamento multiempresa que já mantemos no
Postgres).

Estado atual (implementado e verificado):
- Sessões em banco (tabela `sessions`), cookie `httpOnly`, `sameSite=lax`,
  `secure` em produção. Sessão conferida no banco a cada requisição
  (`cookieCache` desabilitado), o que torna a revogação imediata.
- **Cadastro público desabilitado** (`disableSignUp`): usuários são criados por
  administrador, nunca por auto-registro.
- Senha mínima de 12 caracteres.
- **Hash de senha: scrypt** (padrão do Better Auth) — não Argon2id. scrypt é um
  KDF com custo de memória adequado; migrar para Argon2id é possível via hash
  customizado do Better Auth, e fica registrado como melhoria futura em vez de
  ser descrito como já feito.
- Proteção CSRF por validação de `Origin` no endpoint de autenticação
  (verificada: requisição sem `Origin` ou com origem estrangeira recebe 403).
- Auditoria de login e logout via hooks de banco de sessão, com IP e user-agent.
- Login bem-sucedido zera `failedLoginCount` e grava `lastLoginAt`.
- Campos de bloqueio de conta (`failedLoginCount`, `lockedUntil`) existem no
  schema e são **respeitados na autorização** (usuário bloqueado é tratado como
  inativo). O *incremento* automático a cada falha e a política de recuperação
  de senha ainda não estão implementados — ver `docs/known-limitations.md` §4.
- Multiempresa: sessão resolve `organizationId` a partir do usuário no banco;
  usuário pertence a exatamente uma organização na v1.

Pendente de fases seguintes: MFA (TOTP), recuperação de senha, tela de sessões
ativas com revogação, incremento de tentativas falhas.

## 2. Autorização

RBAC server-side obrigatório em toda mutação e toda leitura sensível — ver
`docs/permissions.md` para a matriz completa. Regra inegociável: **nenhuma
permissão é aplicada apenas escondendo um botão no frontend**. Todo Server
Action e Route Handler chama um middleware de autorização que:
1. Resolve o usuário autenticado e sua organização a partir da sessão (nunca do
   corpo da requisição).
2. Verifica a permissão granular exigida pelo caso de uso.
3. Se o caso de uso envolver `Customer`/`Quote`/`Order`, verifica escopo
   adicional (`read_own` vs `read_all`) comparando `ownerSellerId`/`sellerLinkId`
   com o vendedor vinculado ao usuário — nunca aceitando um `sellerId`
   enviado pelo cliente.

## 3. Nunca confiar no navegador

Lista explícita (reforça briefing §10/§24), aplicada em todo caso de uso de
escrita:
- `organizationId` — sempre da sessão, nunca do payload.
- `sellerId`/`SellerLink` usado num pedido — sempre resolvido a partir do
  usuário autenticado; um `ADMIN` que cria em nome de outro vendedor precisa de
  permissão explícita (`orders.create` + flag adicional) e a ação fica
  registrada em `AuditLog` com o vendedor "real" e o vendedor "em nome de quem".
- Preço, desconto, tabela de preço aplicada — sempre recalculados no backend a
  partir de `PriceTable`/`SellerLink.maxDiscountPercent`/`nDescMaximo` do Omie;
  o valor vindo do formulário é tratado como **sugestão**, não como fato.
- Estoque disponível exibido — revalidado no backend antes de confirmar pedido,
  nunca aceito do estado da tela.
- Permissões e papéis do próprio usuário — nunca lidos do JWT/local storage sem
  checagem contra o banco no momento da ação (evita token antigo com permissão
  já revogada sendo usado).

## 4. Segredos e credenciais Omie

- `app_key`/`app_secret` da Omie: nunca chegam ao navegador, nunca aparecem em
  log, nunca em mensagem de erro exposta ao usuário. Armazenados criptografados
  em repouso (`OmieCredential`, AES-256-GCM com `ENCRYPTION_KEY` fora do banco).
- Toda chamada à Omie acontece exclusivamente em `src/integrations/omie`,
  executado só em contexto de servidor/worker.
- Mascaramento de log: o client Omie tem um serializador de log que substitui
  `app_key`/`app_secret`/CPF/CNPJ/e-mail por valores mascarados antes de
  qualquer `console`/Sentry breadcrumb.
- Rotação de segredo: painel admin permite substituir `app_key`/`app_secret`
  sem downtime (nova credencial testada antes de desativar a antiga).
- `AUTH_SECRET`/`ENCRYPTION_KEY`/`OMIE_WEBHOOK_SECRET` — apenas variáveis de
  servidor, nunca prefixadas com `NEXT_PUBLIC_`.

## 5. Webhook

- Endpoint por organização com token não-adivinhável na URL
  (`/api/webhooks/omie/{organizationId}/{webhookSecretToken}`), já que a Omie
  não documenta publicamente um mecanismo de assinatura HMAC (ver
  `omie-api-mapping.md` §10 — item a confirmar). Token rotacionável pelo admin.
- Proteção contra replay: `WebhookEvent.dedupeKey` único por organização;
  eventos repetidos são marcados `DUPLICATE` e não reprocessados.
  Rate limiting no endpoint de webhook para mitigar abuso mesmo com token
  válido vazado.
- Payload bruto sempre persistido antes de qualquer efeito colateral — nunca
  aplicado diretamente ao domínio sem revalidação via API (ver
  `synchronization-strategy.md` §2).

## 6. Isolamento multiempresa

- Toda tabela de negócio tem `organizationId` obrigatório (não nulo).
- Camada de repositório (Prisma) não expõe métodos que aceitem query sem
  `organizationId` — nenhum "find all" genérico sem escopo, nem em código
  interno de worker.
- Testes de integração dedicados garantem que uma query de uma organização
  nunca retorna linha de outra (ver `docs/development-roadmap.md`, testes de
  segurança/isolamento como critério de aceite de cada módulo).

## 7. Headers, transporte e proteção geral

- HTTPS obrigatório em produção (HSTS).
- Cookies `Secure`, `httpOnly`, `SameSite`.
- CSRF: Server Actions do Next.js já mitigam via origem verificada; o endpoint
  de autenticação valida `Origin` (verificado: 403 sem `Origin` e 403 com origem
  estrangeira). Route Handlers de mutação futuros seguem o mesmo padrão.
- Cabeçalhos: `Content-Security-Policy`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`.
- Rate limiting por IP/usuário nas rotas de autenticação e no endpoint de
  webhook (Redis, algoritmo de janela deslizante).
- Validação Zod em toda fronteira de entrada (Server Action, Route Handler,
  payload de job de fila) — nunca confiar em tipo TypeScript sozinho em tempo
  de execução.
- Sanitização de logs: nenhum dado sensível (senha, `app_secret`, CPF/CNPJ
  completo, token) em log estruturado; usar mascaramento (`***1234` para
  documento) mesmo em ambiente de desenvolvimento.

## 8. LGPD (módulo de clientes)

- Finalidade: só coletamos dados de cliente necessários à operação comercial
  (documento, contato, endereço) — sem campos especulativos.
- Minimização: formulário de cadastro não pede campo que não é usado por algum
  fluxo real (orçamento, pedido, nota fiscal).
- Acesso controlado: `customers.read_all` vs `customers.read_own` já limita
  quem vê o quê; consulta a dado sensível de cliente é auditada
  (`AuditLog.action = "customer.viewed_sensitive"` quando aplicável, ex.
  documento completo).
- Rastreabilidade: toda criação/alteração de cliente audita ator, IP,
  timestamp, antes/depois.
- Retenção: soft delete (`deletedAt`) em vez de exclusão física, com política
  de retenção configurável por organização; exclusão física sob pedido formal
  (direito ao esquecimento) tratada como processo manual assistido, fora do
  escopo de UI da v1, mas o schema já suporta (`deletedAt` + job de purge).

## 9. Observabilidade sem vazamento

`/api/health` e `/api/ready` não retornam versão de dependência sensível,
string de conexão, nem status detalhado de credenciais — apenas
`ok`/`degraded`/`down` por subsistema (db, redis, omie). Sentry (ou
equivalente) configurado com `beforeSend` que aplica o mesmo mascaramento de
log da seção 7.
