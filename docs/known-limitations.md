# Limitações Conhecidas

Documento vivo. Registra o que **não sabemos** ou **não podemos garantir** —
para que nenhuma decisão de implementação seja tomada por suposição, e para que
nenhuma promessa incorreta chegue ao usuário final.

## 1. Lacunas na documentação pública da Omie (bloqueiam implementação específica)

| # | Lacuna | Impacto | Como resolver |
|---|---|---|---|
| 1 | Lista completa de tópicos/eventos de webhook não é pública | Não sabemos quais entidades geram evento; só `produto.alterado` está confirmado nominalmente | Administrador abre o portal do desenvolvedor autenticado → aplicativo → "Adicionar novo webhook" → copiar lista de eventos para `omie-api-mapping.md` §10 |
| 2 | Não há mecanismo de assinatura/HMAC documentado para validar origem do webhook | Não podemos provar criptograficamente que um POST veio da Omie | Mitigado com URL-token por organização + revalidação via API. Reavaliar se a Omie publicar assinatura |
| 3 | Momento exato em que um pedido não faturado reserva/pendencia estoque | Não podemos afirmar que "criar pedido reserva estoque" | Validar empiricamente em empresa demo: criar pedido em etapa `"10"`, consultar `ObterEstoqueProduto` antes/depois, comparar `nReservado`/`nPrevisaoSaida` |
| 4 | Payload exato (schema) de cada evento de webhook | Handlers específicos não podem ser escritos com segurança | Capturar payloads reais (persistidos brutos em `WebhookEvent`) após configurar o primeiro webhook |
| 5 | Diferença entre API de pedido "simplificada" e "completa" | Podemos estar usando o serviço menos adequado | Confirmar no portal; até lá usamos apenas `produtos/pedido/` (completa) |
| 6 | Detalhamento de `produtos/formaspagvendas/` e `geral/meiospagamento/` | Passo "escolher pagamento" do fluxo de venda não pode ser finalizado | Consultar as duas páginas de documentação antes de implementar `PaymentTermsService` |
| 7 | Limite máximo de `registros_por_pagina` por serviço | Paginação pode falhar em serviços com limite menor que o assumido | Cada adapter de paginação valida a resposta e ajusta; não assumir 100 universalmente |
| 8 | Formato de erro não é uniforme entre serviços | Classificação de erro pode ter buracos | Client Omie tem branch de fallback `UNKNOWN_ERROR` que **nunca** é silenciado — sempre logado com correlation ID e visível no painel admin |
| 9 | Se o cadastro de cliente Omie tem tabela de preço padrão vinculável | Precedência de tabela cliente→preço pode ser só local | Confirmar campos de `ConsultarCliente` numa resposta real |

## 2. Limitações inerentes (não resolvíveis, apenas gerenciáveis)

- **Não existe exclusão mútua perfeita contra overselling.** Outros sistemas
  (o próprio Omie, PDV, marketplaces) vendem o mesmo estoque. Revalidamos
  imediatamente antes de enviar o pedido e detectamos conflito depois, mas a
  UI **nunca deve prometer** que o estoque está reservado para o vendedor.
- **Webhook não é garantia.** Pode haver atraso, duplicação, evento fora de
  ordem, falha de entrega e ausência de evento para certos recursos. Por isso a
  reconciliação periódica é obrigatória, não opcional.
- **Rate limit de 240 req/min por app_key** é compartilhado entre sincronização
  em background e ações de vendedor em tempo real. Em catálogos grandes, a
  sincronização completa é necessariamente lenta — o produto precisa comunicar
  "última atualização" honestamente em vez de sugerir tempo real.
- **Etapas de Kanban são customizáveis por conta Omie.** Os valores `"00"`,
  `"10"`…`"50"` são o padrão observado na documentação, mas cada organização
  pode ter configuração diferente — por isso ficam em
  `OrganizationSettings`, nunca hardcoded.
- **A Omie não tem conceito de "usuário do sistema" equivalente ao nosso.**
  O vínculo usuário↔vendedor é uma construção local (`SellerLink`), e o Omie
  não valida se o vendedor informado num pedido corresponde a quem realmente
  operou — a rastreabilidade real desse vínculo é nossa responsabilidade
  (auditoria).
- **`SellerLink.maxDiscountPercent` e `defaultPriceTableId` não existem no
  Omie** (confirmado). Se um pedido for criado diretamente no Omie por fora do
  app, esses limites não são aplicados.

## 3. Escopo deliberadamente não implementado na v1

WMS físico completo (endereçamento, picking, packing, ondas de separação,
conferência por código de barras, romaneios, expedição, inventário cíclico) —
apenas visibilidade de estoque. A arquitetura deixa espaço (entidades
`Warehouse`, `InventoryMovement` já existem), mas nenhum desses módulos foi
projetado em detalhe e não devem ser prometidos como "quase prontos".

## 4. Estado atual do repositório (Fase 3 concluída)

Existe fundação funcional: projeto Next.js 16 com TypeScript estrito, Postgres +
Prisma 7 com migration inicial, Redis, autenticação, RBAC aplicado no servidor,
layout mobile-first, painel administrativo básico, Docker Compose, logs
estruturados com mascaramento, health/ready e 64 testes automatizados.

**Verificado de ponta a ponta** contra Postgres 16 e Redis 7 reais: migration,
seed, login com senha correta e recusa com senha errada, CSRF por `Origin`,
auditoria de login/logout com IP e user-agent, permissões por página devolvendo
403, e isolamento multiempresa (duas organizações, incluindo o mesmo código de
vendedor Omie em ambas, sem vazamento em nenhuma direção).

**Fase 4 concluída**: existe o client de integração completo — rate limiter de
240 req/min por organização, retry com backoff exponencial e jitter, timeout,
circuit breaker por organização, classificação de erro, validação Zod de toda
resposta, mappers Omie→DTO, paginação retomável, modo mock com fixtures e
credenciais cifradas em repouso (AES-256-GCM) com painel de configuração e teste
de conexão.

**Limitações específicas da Fase 4:**
- `ListarTabelasPreco` **não é exposto**: o nome do array na resposta não pôde
  ser confirmado na documentação consultada. Só `ListarTabelaItens` está
  disponível. Confirmar antes de implementar a listagem de tabelas.
- O modo mock não simula latência da Omie, ordenação real nem todos os filtros —
  serve para desenvolver e demonstrar, não para medir desempenho.
- O circuit breaker é **por processo** (in-memory), não compartilhado entre
  réplicas. Cada réplica descobre a indisponibilidade por conta própria em
  poucas requisições. Decisão registrada em `circuit-breaker.ts`.
- Nenhuma chamada real à API da Omie foi executada ainda: toda a verificação
  desta fase usou o transporte mock. O caminho HTTP real só será exercitado
  quando uma credencial válida for configurada.
- Os serviços de pedido/orçamento (`produtos/pedido`) ainda não têm service —
  entram na Fase 5, junto com a idempotência de escrita.

## 5. Limitações do catálogo, estoque e clientes

> Os dois primeiros itens desta lista foram **resolvidos na Fase 6**: a
> sincronização agora roda em fila, sem limite de páginas, e o estoque tem job
> próprio. O que permanece é a ausência de *agendamento* automático — ver §7.
- **A regra `CUSTOM` de disponibilidade não tem implementação.** Escolhê-la faz
  toda posição ser reportada como indeterminada, em vez de cair silenciosamente
  numa fórmula arbitrária.
- **A tela de produto mostra o preço do cadastro**, não o preço resolvido pela
  tabela — e diz isso explicitamente. O preço real é calculado no servidor ao
  montar o orçamento, onde o cliente é conhecido.
- **Tabelas de preço ainda não são sincronizadas** para o cache local: falta o
  `ListarTabelasPreco`, não implementado por não ter o nome do array confirmado.
- **Edição de cliente ainda não existe** — só criação e consulta.
- A busca usa `contains` case-insensitive. Suficiente para o volume de uma
  distribuidora; um catálogo muito grande pediria índice GIN com trigram.

## 6. Limitações de orçamentos e pedidos

- **`ListarPedidos` não é implementado**: o nome do array na resposta não pôde
  ser confirmado na documentação. A listagem local não depende dele, mas a
  reconciliação de pedidos alterados diretamente no Omie vai precisar — confirmar
  antes da Fase 6.
- **Aprovação de desconto não tem tela.** O `ApprovalRequest` é criado e
  **bloqueia o envio**, mas ainda não existe interface para o gerente aprovar ou
  recusar. Hoje isso exige intervenção no banco.
- **O teto de aprovação é fixo em 30%**, não configurável por organização ainda.
- **Frete, transportadora e parcelas** não são coletados: o pedido vai com
  `codigo_parcela` padrão. `lista_parcelas` (exigida quando `codigo_parcela` é
  `"999"`) não é montada.
- **A revalidação de estoque antes do envio usa o cache local**, não uma leitura
  direta à Omie. A leitura direta existe no botão "atualizar estoque" da tela do
  produto, mas ainda não é disparada automaticamente no envio — é a melhoria mais
  relevante pendente para reduzir overselling.
- **Sem posição de estoque em cache, a venda não é bloqueada.** É decisão
  deliberada: bloquear um item recém-cadastrado seria pior que deixar a Omie —
  que é a autoridade real — recusar.
- **Numeração local usa `MAX + 1`**, sem contador transacional. A constraint
  única transforma colisão sob concorrência em erro visível, nunca em dois
  documentos com o mesmo número, mas o contador adequado entra com as filas.
- **Cancelamento e edição de orçamento** ainda não existem.

## 7. Limitações de filas, webhooks e reconciliação (Fase 6)

- **Não há agendamento automático.** As filas e a reconciliação existem e
  funcionam, mas dependem de disparo manual pelo painel. Repeatable jobs do
  BullMQ são o próximo passo — sem eles, o catálogo continua envelhecendo até
  alguém clicar.
- **Dead-letter não tem painel.** Jobs que esgotam as tentativas vão para a fila
  `omie-dead-letter` e marcam o `SyncJob` como `DEAD_LETTER`, visível na lista,
  mas não há botão de reprocessar — exige inspeção manual da fila.
- **Sincronização de clientes Omie→local não implementada.** O job existe e
  **falha explicitamente** com essa mensagem, em vez de fingir sucesso. O
  caminho local→Omie funciona.
- **Reconciliação de clientes** idem.
- **Pedido criado direto no Omie não vira registro local.** O webhook atualiza
  documentos que já existem aqui, mas não cria um a partir de um evento — isso
  dependeria de `ListarPedidos`, cujo array de resposta não foi confirmado.
- **A extração de entidade do payload é heurística.** Procura identificadores
  conhecidos em qualquer profundidade. O que não é reconhecido vira `UNHANDLED`
  com o payload preservado — nunca um palpite aplicado ao banco. Handlers
  específicos só serão escritos depois de ver payloads reais.
- **O token do webhook não é rotacionável pela interface.** Substituir a
  credencial preserva o token de propósito (regenerá-lo quebraria a configuração
  no portal da Omie), mas isso significa que rotacionar exige intervenção manual.
- **A revalidação de estoque no envio não bloqueia se a consulta falhar.** Cai
  para o cache local: impedir a venda por indisponibilidade momentânea da
  consulta seria pior que vender com dado de segundos atrás.

**Ainda NÃO existe** (não confundir com pronto):
- Agendamento automático de reconciliação e sincronização.
- Notificações ao usuário (a tabela existe, nada escreve nela ainda).
- SSE/tempo real na interface — as telas atualizam por navegação, não por push.
- Nenhuma fila, worker, webhook ou reconciliação. Fase 6.
- Incremento automático de tentativas falhas de login, recuperação de senha, MFA
  e tela de revogação de sessões (campos existem no schema e o bloqueio é
  respeitado na autorização, mas nada incrementa o contador ainda).
- Criação/edição de usuários e vínculos de vendedor pela interface — hoje via
  seed ou banco.
- Testes E2E de navegador e testes de integração com banco (os 64 testes atuais
  cobrem o núcleo puro: permissões, escopo multiempresa, mascaramento, erros).
