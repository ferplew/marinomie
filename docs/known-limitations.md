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

## 4. Estado atual do repositório

Nesta entrega existe **apenas documentação de arquitetura** (Fases 1 e 2). Não
há código de aplicação, schema Prisma, Docker Compose ou testes ainda — esses
são o conteúdo da Fase 3 em diante (`docs/development-roadmap.md`). Qualquer
afirmação de que a plataforma "funciona" neste momento seria falsa.
