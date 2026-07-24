# Mapeamento da API Omie

> Este documento é a fonte única de verdade sobre **como o Omie realmente se comporta**.
> Nenhum endpoint, método, campo ou comportamento aqui descrito foi inventado — cada
> afirmação foi verificada em `developer.omie.com.br`, `app.omie.com.br/api/v1/...`
> (páginas de documentação interativa de cada serviço) ou `ajuda.omie.com.br`, com a
> URL de origem citada. Onde a documentação pública não é suficiente (ex.: lista
> completa de tópicos de webhook, limites exatos por plano), o item é marcado
> explicitamente como **"A confirmar"** e uma ação concreta é indicada — normalmente
> "confirmar dentro do portal do desenvolvedor autenticado com o app_key real da
> empresa", porque parte da documentação de webhooks só é visível autenticado.
>
> **Nunca implemente contra um item marcado "A confirmar" sem antes confirmá-lo.**

## 1. Convenções gerais da API

Fonte: `developer.omie.com.br/quick-start/`, `ajuda.omie.com.br/pt-BR/articles/5412721-caracteristicas-e-recomendacoes-das-apis-do-omie`, `github.com/omiexperience/api-examples`.

| Aspecto | Comportamento confirmado |
|---|---|
| Protocolo | HTTP POST apenas (GET é bloqueado por segurança). Suporta JSON e SOAP; usaremos exclusivamente **JSON**. |
| Content-Type | `application/json` |
| URL base | `https://app.omie.com.br/api/v1/{categoria}/{recurso}/` (ex.: `.../geral/clientes/`, `.../produtos/pedido/`) |
| Corpo da requisição | `{ "call": "<NomeDoMetodo>", "app_key": "...", "app_secret": "...", "param": [ { ...campos... } ] }` — `param` é sempre um **array com um único objeto**. |
| Autenticação | `app_key` / `app_secret` do aplicativo cadastrado no portal do desenvolvedor. Não há OAuth; são credenciais estáticas por aplicação/empresa. |
| Rate limit | **240 requisições por minuto** por app_key (fonte: artigo de tratamento de erros). Retorna erro "Too Many Requests" ao exceder — nosso client precisa de limitador de taxa (token bucket) e backoff. |
| Erros | Não há um envelope de erro único documentado publicamente com certeza (SOAP usa `faultcode`/`faultstring`; JSON retorna HTTP 500 com corpo descritivo em vários casos, ou HTTP 200 com `cCodStatus`/`cDesStatus` != sucesso, dependendo do serviço). **Cada serviço tem seu próprio formato de status** — ver seção 10. **A confirmar por serviço**: validar amostra real de erro para cada chamada usada, via ambiente de teste do portal. |
| Paginação | Convenção comum (nem todos os serviços usam os mesmos nomes): página atual, total de páginas, registros retornados, total de registros. Nomes variam por serviço (`pagina`/`nPagina`, `registros_por_pagina`/`nRegPorPagina`, etc. — ver tabela por domínio). |
| REST | Omie não oferece API REST própria (apenas JSON-RPC-like sobre POST). |

## 2. Tabela-resumo por domínio

| Domínio | Serviço Omie | Endpoint | Principais métodos | Direção | Webhook | Estratégia local |
|---|---|---|---|---|---|---|
| Produtos | ProdutoServico | `/geral/produtos/` | `ListarProdutos`, `ListarProdutosResumido`, `ConsultarProduto`, `IncluirProduto`, `AlterarProduto`, `UpsertProduto` | Omie → App (App não cria produto) | Existe evento `produto.alterado` confirmado; lista completa **A confirmar** no portal | Cache local com TTL curto + sync incremental por página/data |
| Estoque (posição) | EstoqueConsulta | `/estoque/consulta/` (métodos `ListarPosEstoque`, `PosicaoEstoque`) e `/estoque/resumo/` (`ObterEstoqueProduto`) | ver seção 4 | Omie → App | **A confirmar** (não há evento específico de estoque documentado publicamente) | Cache curtíssimo (15–60s) + reconciliação frequente, nunca fonte única para confirmar venda |
| Locais de estoque | LocalEstoque | `/estoque/local/` | `ListarLocaisEstoque`, `IncluirLocalEstoque`, `AlterarLocalEstoque` | Omie → App | **A confirmar** | Cache longo (cadastro auxiliar, muda pouco) |
| Movimentação de estoque | MovEstoque | `/estoque/movestoque/`, `/estoque/consulta/` (`ListarMovimentoEstoque`, `MovimentoEstoque`) | ver seção 4 | Omie → App | **A confirmar** | Consulta sob demanda (auditoria/histórico), não replicado localmente |
| Clientes | ClientesCadastro | `/geral/clientes/` | `ListarClientes`, `ListarClientesResumido`, `ConsultarCliente`, `IncluirCliente`, `AlterarCliente`, `UpsertCliente`, `UpsertClienteCpfCnpj` | Bidirecional | **A confirmar** | Sync controlado com `codigo_cliente_integracao` como chave de idempotência |
| Vendedores | VendedoresCadastro | `/geral/vendedores/` | `ListarVendedores`, `ConsultarVendedor`, `IncluirVendedor`, `AlterarVendedor`, `UpsertVendedor` | Omie → App | **A confirmar** | Associação local via `SellerLink` (cache de cadastro auxiliar) |
| Tabelas de preço | TabelaPrecos | `/produtos/tabelaprecos/` | `ListarTabelasPreco`, `ConsultarTabelaPreco`, `ListarTabelaItens`, `IncluirTabelaPreco`, `AlterarTabelaPreco`, `AlterarPrecoItem`, `AtivarTabelaPreco`, `SuspenderTabelaPreco` | Omie → App | **A confirmar** | Cache 5–15 min por item de tabela |
| Formas/condições de pagamento | Parcelas / MeiosPagamento | `/geral/parcelas/`, `/geral/meiospagamento/`, `/produtos/formaspagvendas/` | `ListarParcelas`, `IncluirParcela` | Omie → App | **A confirmar** | Cache longo (cadastro auxiliar) |
| Pedidos de venda / Orçamentos | PedidoVendaProduto | `/produtos/pedido/` | `IncluirPedido`, `AlterarPedidoVenda`, `ConsultarPedido`, `ListarPedidos`, `StatusPedido`, `ExcluirPedido`, `TrocarEtapaPedido`, `SimularImpostos` | Bidirecional | **A confirmar** | Idempotência obrigatória via `codigo_pedido_integracao` |

Fontes primárias desta tabela: `app.omie.com.br/api/v1/geral/produtos/`, `.../estoque/consulta/`, `.../estoque/resumo/`, `.../estoque/local/`, `.../geral/clientes/`, `.../geral/vendedores/`, `.../produtos/tabelaprecos/`, `.../geral/parcelas/`, `.../produtos/pedido/` (documentação interativa de cada serviço, consultada em 2026-07-24), além de `developer.omie.com.br/service-list/`.

## 3. Orçamento × Pedido de Venda — a distinção real

Fonte: `ajuda.omie.com.br/pt-BR/articles/6596152-incluindo-um-orcamento-ou-pedido-de-venda-via-api`, `app.omie.com.br/api/v1/produtos/pedido/`.

**Não existe um serviço/endpoint separado para "orçamento".** Orçamento e Pedido de Venda são o **mesmo recurso** (`PedidoVendaProduto`), diferenciados pelo campo `etapa`:

- `"etapa": "00"` → o registro é tratado como **Orçamento/Cotação**. Segundo a documentação, se o recurso de orçamento ainda não estiver ativo no app do cliente, enviar `etapa: "00"` **ativa automaticamente** esse recurso — implicação de produto: a primeira sincronização de orçamento pode exigir aviso ao administrador.
- Etapas seguintes (`"10"`, `"20"`, `"30"`, `"40"`) representam posições no funil comercial (Kanban de vendas) **antes do faturamento**.
- `"50"` é observado como estágio de **faturamento** ("Faturar").
- `TrocarEtapaPedido` move o registro entre etapas; a documentação de ajuda confirma a regra de negócio: *"se o pedido ainda não foi faturado, só pode ser movido para etapas anteriores ao faturamento; se já foi faturado e depois cancelado, só pode ser movido para etapas posteriores ao faturamento."*

**Consequência de arquitetura:** nossa entidade local `Quote` (orçamento) e `Order` (pedido) são conceitos de **domínio próprio da aplicação**, não um espelho 1:1 de dois recursos Omie diferentes. Um `Quote` local que é enviado ao Omie sempre vira um registro Omie com `etapa = "00"`; a "conversão em pedido" (`quotes.convert`) é a chamada `TrocarEtapaPedido` movendo o mesmo registro Omie de `"00"` para a primeira etapa de pedido confirmado (`"10"` por padrão, configurável), **não** uma nova inclusão.

**A confirmar:**
- Se existe reserva de estoque no momento em que `etapa` deixa de ser `"00"`, ou apenas no faturamento. A documentação pública não descreve o exato ponto em que o Omie debita/reserva estoque para um pedido não faturado — **isto precisa ser validado empiricamente em ambiente de teste (sandbox/empresa demo) antes de confiarmos em qualquer regra de "estoque reservado por pedido pendente" como certeza**. Até a confirmação, tratamos `nPendente`/`reservado`/`nPrevisaoSaida` retornados pela API de estoque (seção 4) como a fonte de verdade, e não fazemos suposições adicionais no código.
- Quais etapas exatas (nomes e códigos) uma organização específica tem configuradas — etapas de Kanban são customizáveis por conta, então os valores `"10"`–`"40"` são o *default*, mas devem ser lidos via `TrocarEtapaPedido`/tela de configuração de etapas e armazenados por organização, nunca hardcoded no domínio compartilhado.

## 4. Estoque — campos e o que cada um representa

Fonte: `app.omie.com.br/api/v1/estoque/consulta/` e `app.omie.com.br/api/v1/estoque/resumo/`.

Existem **dois serviços de leitura de estoque** com nomenclaturas de campo diferentes — nosso mapper precisa normalizar ambos para o mesmo DTO interno:

### 4.1 `estoque/consulta/` — métodos `ListarPosEstoque` / `PosicaoEstoque`

| Campo Omie | Significado |
|---|---|
| `fisico` | Estoque físico (quantidade em local) |
| `reservado` | Quantidade reservada |
| `nPendente` / `pendente` | Saldo pendente (movimentos ainda não concluídos) |
| `nSaldo` / `saldo` | Saldo consolidado |
| `estoque_minimo` | Estoque mínimo configurado |
| `cmc` / `nCMC` | Custo médio de compra |

### 4.2 `estoque/resumo/` — método `ObterEstoqueProduto`

| Campo Omie | Significado |
|---|---|
| `nFisico` | Físico, por local (`listaEstoque[]`, chave `nIdlocal`) |
| `nReservado` | Reservado, por local |
| `nPrevisaoSaida` | Previsão de saída (pendências de saída — pedidos/OS ainda não faturados) |
| `nPrevisaoEntrada` | Previsão de entrada (compras/produção a receber) |
| `nDisponivel` | **Já vem calculado pelo Omie** como saldo disponível |
| `nEstoqueMinimo` | Estoque mínimo |

**Decisão de produto:** como o Omie já expõe `nDisponivel` calculado, a regra `AvailableStockRule` (seção 7 do briefing) tem um valor adicional possível: `"OMIE_CALCULATED"` (usa `nDisponivel` diretamente), além das fórmulas locais (`PHYSICAL_MINUS_RESERVED`, etc.), documentado em `docs/database-model.md` e configurável por organização. Não presumimos que `nDisponivel` = `físico - reservado` sem ver a fórmula exata documentada pela Omie — por isso ele fica disponível como opção, não como única verdade.

**A confirmar:** granularidade por local de estoque para pedidos multi-depósito (`codigo_local_estoque` aparece como parâmetro opcional em vários métodos — precisa ser testado se a resposta é sempre por local ou pode ser consolidada); latência real entre uma venda e a atualização desses campos (não documentada — tratar como "eventualmente consistente", nunca instantânea garantida).

## 5. Clientes

Fonte: `app.omie.com.br/api/v1/geral/clientes/`.

- Métodos: `IncluirCliente`, `AlterarCliente`, `ConsultarCliente`, `ExcluirCliente`, `ListarClientes`, `ListarClientesResumido`, `UpsertCliente` (por `codigo_cliente_integracao`), `UpsertClienteCpfCnpj` (por CPF/CNPJ). `IncluirClientesPorLote`/`UpsertClientesPorLote` estão **depreciados** — não usar.
- Campos exigidos para emissão fiscal (NF-e/NFS-e): `razao_social`, `cnpj_cpf`, `nome_fantasia`, `email`, `contribuinte`, `optante_simples_nacional`. Mesmo quando o app não emite nota, recomendamos capturar esses campos no cadastro para evitar retrabalho quando o cliente vira faturamento.
- `codigo_cliente_integracao` é o **identificador de integração** — chave de idempotência para criar/atualizar sem duplicar. Reutilizar sempre o mesmo valor por cliente local (nunca gerar um novo a cada retry).
- Preferência de implementação: usar `UpsertClienteCpfCnpj` para inclusão (idempotente por documento) combinado com nosso `codigo_cliente_integracao` próprio (UUID local) — assim cobrimos deduplicação tanto por documento quanto por nosso identificador.
- **A confirmar:** existência de webhook para alteração de cliente feita diretamente no Omie (fora do app) — sem isso, sincronização de clientes depende de polling incremental por `filtrar_por_data_de/ate`.

## 6. Vendedores

Fonte: `app.omie.com.br/api/v1/geral/vendedores/`.

- Métodos: `ListarVendedores`, `ConsultarVendedor`, `IncluirVendedor`, `AlterarVendedor`, `ExcluirVendedor`, `UpsertVendedor`.
- Campos: `codigo` (ID Omie), `codInt` (código de integração), `nome`, `email`, `inativo` (S/N), `fatura_pedido` (S/N), `visualiza_pedido` (S/N), `comissao`.
- **Confirmado por ausência**: a API de vendedores **não tem** campo de tabela de preço padrão nem limite de desconto. Esses dois atributos (`defaultPriceTableId`, `maxDiscountPercent`) são, portanto, **exclusivamente locais** — vivem em `SellerLink`, nunca no Omie. Isso é uma decisão de arquitetura direta desta descoberta, não uma suposição.
- A criação do vendedor no Omie continua manual/administrativa (fora do escopo inicial do app); a aplicação apenas **lista e associa** (`ListarVendedores` → `SellerLink.omieSellerId`).

## 7. Tabelas de preço

Fonte: `app.omie.com.br/api/v1/produtos/tabelaprecos/`.

- Métodos: `ListarTabelasPreco`, `ConsultarTabelaPreco`, `ListarTabelaItens`, `IncluirTabelaPreco`, `AlterarTabelaPreco`, `AlterarPrecoItem`, `AtivarTabelaPreco`, `SuspenderTabelaPreco`, `AtualizarProdutos`, `ExcluirTabelaPreco`.
- Preço por item vem de `ListarTabelaItens`: `nValorTabela` (preço de tabela), `nValorOriginal`, `nValorCalculado`, `nPercDesconto`, `nPercAcrescimo`, `nDescSugerido`, `nDescMaximo`, `cManual`.
- **Importante para o módulo de descontos:** o Omie já expõe `nDescMaximo` (desconto máximo permitido) por item de tabela — isso deve alimentar a validação de desconto no backend (seção 14 do briefing), como um teto adicional acima do `maxDiscountPercent` do vendedor. O menor entre os dois limites prevalece.
- **A confirmar:** como a tabela de preço é vinculada a cliente vs. vendedor — a API de tabela de preços não expõe esse vínculo diretamente; a princípio esse relacionamento (cliente→tabela, vendedor→tabela padrão) parece ser regra de negócio configurável **apenas no nosso app**, com o Omie apenas fornecendo os valores da tabela escolhida. Precisa confirmação se o cadastro de cliente no Omie (`geral/clientes/`) tem campo de tabela de preço padrão — não observado nos campos documentados publicamente.

## 8. Formas e condições de pagamento

Fonte: `app.omie.com.br/api/v1/geral/parcelas/`, `developer.omie.com.br/service-list/` (categorias "Formas de Pagamento" e "Meios de Pagamento").

- `ListarParcelas` retorna `cadastros[]` com código e descrição do número de parcelas (ex.: "30/60/90").
- `IncluirParcela` cria uma nova condição.
- Meios de pagamento (`geral/meiospagamento/`) e formas de pagamento específicas de venda (`produtos/formaspagvendas/`) — **detalhamento de campos ainda não verificado em profundidade**; marcar como **A confirmar** antes de implementar o passo "escolher pagamento" do fluxo de venda. Ação: repetir o processo de WebFetch desta sessão nessas duas URLs antes de codificar `PaymentTermsService`.

## 9. Pedido de Venda / Orçamento — campos de inclusão

Fonte: `app.omie.com.br/api/v1/produtos/pedido/`.

Métodos: `IncluirPedido`, `AlterarPedidoVenda`, `ConsultarPedido`, `ListarPedidos`, `StatusPedido`, `ExcluirPedido`, `DevolverPedido`, `TrocarEtapaPedido`, `AlterarPedFaturado`, `SimularImpostos`.

Campos principais na inclusão:
- Cabeçalho: `codigo_cliente`, `data_previsao`, `etapa`, `codigo_parcela`, `codigo_pedido_integracao` (**chave de idempotência** — reutilizar sempre o mesmo valor em retries).
- Itens: `codigo_produto`, `quantidade`, `valor_unitario`.
- Vendedor: aparece em `informacoes_adicionais.codVend` (opcional) — nossa aplicação **sempre** preenche esse campo no backend a partir do `SellerLink` do usuário autenticado; nunca a partir de um valor vindo do navegador.
- Tabela de preço no pedido: `codigo_tabela_preco` a nível de produto/item (opcional).
- Paginação de `ListarPedidos`: `pagina`, `registros_por_pagina` (máx. 100 observado na doc consultada — **confirmar limite exato** antes de assumir).
- `numero_pedido` é o identificador Omie gerado na resposta de `IncluirPedido` — deve ser armazenado em `Order.omieId`/`Quote.omieId`.

**A confirmar:**
- Formato exato de erro de `IncluirPedido` em caso de timeout/duplicidade (necessário para a estratégia "consultar antes de repetir" da seção 15/16 do briefing) — validar com `ConsultarPedido` por `codigo_pedido_integracao` em ambiente de teste.
- Diferença prática entre a API "Pedido de Venda simplificado" e "completo" citadas na listagem de serviços (`developer.omie.com.br/service-list/`) — a URL específica do serviço simplificado não pôde ser confirmada nesta sessão (retornou 404 ao acessar `produtos/pedidosimples/`); **usar apenas a API completa (`produtos/pedido/`) até essa distinção ser esclarecida no portal**.

## 10. Webhooks

Fonte: `ajuda.omie.com.br/pt-BR/articles/9565655-caracteristicas-e-recomendacoes-dos-webhooks`, `ajuda.omie.com.br/pt-BR/articles/5412754-utilizando-os-webhooks-no-omie`.

**Confirmado:**
- Entrega via POST agrupada por (aplicativo Omie, endpoint de webhook), processada em ordem **FIFO por grupo** — enquanto um POST de um grupo está sendo repetido, nenhum outro POST do mesmo grupo é tentado (ou seja, ordem é garantida *dentro do mesmo grupo*, não entre grupos diferentes).
- Fila principal: timeout de resposta esperado em até **7 segundos**; se não houver 2XX, o Omie tenta novamente em intervalos de 1–4s, até 3 tentativas.
- Após esgotar a fila principal, o evento vai para uma **dead-letter queue própria da Omie**: novas tentativas a cada ~10 minutos, por até **5 dias**, com timeout de até 20s.
- Configuração: dentro do portal do desenvolvedor, por aplicativo → "Adicionar novo webhook" → informar URL do endpoint → selecionar eventos → Omie envia notificação de teste. Mudanças só valem para novas sessões do Omie.
- Existe ao menos o evento `produto.alterado` (confirmado nominalmente no artigo de ajuda).

**A confirmar (crítico, requer acesso autenticado ao portal com o app_key real da empresa):**
- Lista completa de tópicos/eventos disponíveis (estoque, cliente, pedido, orçamento, NF-e, OS) — a documentação pública não enumera todos; o portal do desenvolvedor mostra a lista completa apenas dentro da tela de configuração do webhook, autenticado. **Ação:** o administrador da organização deve, na Fase 3/4, abrir o painel "Adicionar novo webhook" no app Omie da empresa e copiar a lista de eventos disponíveis para este documento antes de implementarmos os `handlers` de cada tópico.
- Existência (ou não) de um segredo/assinatura HMAC para validar autenticidade do payload — **não documentado publicamente**. Até confirmação, nosso endpoint de webhook trata a URL em si como o segredo (gerar um path não-adivinhável por organização, ex. `/api/webhooks/omie/{organizationId}/{webhookSecretToken}`), registra IP de origem para análise, e **não confia** apenas no payload — sempre revalida os dados críticos consultando a API antes de aplicar mudanças (padrão "webhook como gatilho, não como fonte", conforme item 6 do briefing).
- Payload exato de cada evento (schema) — desconhecido até a primeira captura real. Por isso, a Fase 6 sempre armazena o payload bruto (`WebhookEvent.rawPayload: Json`) antes de qualquer parsing, permitindo reprocessamento se o schema assumido estiver errado.

## 11. Identificadores — resumo

| Conceito | Campo Omie | Observação |
|---|---|---|
| ID interno do produto | `codigo_produto` / `nIdProduto` | Numérico, gerado pelo Omie |
| Código de integração do produto | `codigo_produto_integracao` | Definido por quem integra |
| ID interno do cliente | `codigo_cliente` | Numérico, gerado pelo Omie |
| Código de integração do cliente | `codigo_cliente_integracao` | Chave de idempotência |
| ID interno do vendedor | `codigo` (em VendedoresCadastro) | Numérico |
| Código de integração do vendedor | `codInt` | Opcional |
| ID interno do pedido/orçamento | `numero_pedido` | Gerado na resposta de `IncluirPedido` |
| Código de integração do pedido | `codigo_pedido_integracao` | Chave de idempotência — nunca regenerar em retry |
| ID da tabela de preço | `nCodTabPreco` | Numérico |
| Código de integração da tabela | `cCodIntTabPreco` | Opcional |

## 12. Itens ainda pendentes de confirmação oficial (consolidado)

1. Lista completa de eventos de webhook por domínio (produtos, estoque, clientes, pedidos/orçamentos, NF-e) — requer portal autenticado.
2. Mecanismo de assinatura/validação de origem do webhook.
3. Momento exato em que um pedido não faturado gera reserva/pendência de estoque (etapa `"00"` vs. `"10"`+).
4. Detalhamento de `produtos/formaspagvendas/` e `geral/meiospagamento/`.
5. Diferença entre API de pedido "simplificada" e "completa" citada na listagem de serviços.
6. Limite exato de `registros_por_pagina` por serviço (observado até 100 em alguns; não confirmado como universal).
7. Formato de erro padronizado (ou a ausência dele) por serviço — hoje sabemos que existe `cCodStatus`/`cDesStatus` em vários serviços de escrita, mas não é 100% uniforme em todos.
8. Se o cadastro de cliente no Omie possui campo de tabela de preço padrão vinculável.

Nenhuma implementação de código desta plataforma deve resolver esses pontos "adivinhando" — cada um vira uma tarefa explícita de validação em ambiente de teste (empresa demo/sandbox da Omie) antes da respectiva Fase 4/5 ser dada como concluída, registrada também em `docs/known-limitations.md`.
