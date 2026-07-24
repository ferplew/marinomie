# Configuração da Integração Omie

## 1. Obter as credenciais

No [portal do desenvolvedor Omie](https://developer.omie.com.br/), cadastre um
aplicativo e copie `app_key` e `app_secret`.

## 2. Configurar na plataforma

**Admin → Integrações → Configurar credencial.**

As credenciais são cifradas em repouso (AES-256-GCM) e nunca são devolvidas à
interface — o painel mostra apenas os 4 últimos dígitos da `app_key`. Para
trocar, digite os valores novamente.

Use **Testar conexão** para confirmar. O teste chama `ListarVendedores` com um
registro: é leitura, barata, e exercita exatamente o que importa (credencial
válida + conta respondendo).

## 3. Sair do modo mock

Enquanto `OMIE_MOCK_MODE=true`, **nenhuma chamada real é feita** — as respostas
vêm de fixtures locais. Para usar a API real:

```bash
OMIE_MOCK_MODE=false
```

Reinicie o app **e o worker**. O painel de Integrações mostra qual modo está
ativo.

## 4. Primeira sincronização

**Admin → Sincronizações → Catálogo.** A ação enfileira e retorna na hora; o
worker processa página a página, encadeando a seguinte. Acompanhe o progresso na
mesma tela.

Depois, **Estoque** para trazer as posições dos produtos ativos.

> Se os jobs ficarem em "na fila", não há worker rodando.

## 5. Vincular vendedores

Cada usuário vendedor precisa de um `SellerLink` apontando para um vendedor do
Omie. Sem o vínculo, o usuário não consegue criar orçamento — e a mensagem na
tela diz isso.

Atenção: `maxDiscountPercent` e `defaultPriceTableId` **não existem na API de
vendedores da Omie** (confirmado). São atributos exclusivamente locais, e um
pedido criado direto no ERP não os respeita.

## Limites que moldam a operação

- **240 requisições por minuto por `app_key`**, compartilhado com qualquer outra
  integração do cliente (Power BI, marketplaces). O limitador usa um teto
  efetivo menor por padrão, justamente para não prejudicar as demais.
- Ação de vendedor tem prioridade sobre sincronização: um job de background
  desiste da vaga na hora e volta para a fila.
- Sincronização de catálogo grande é necessariamente lenta. O produto comunica
  "última atualização" em vez de sugerir tempo real.

## Ordem recomendada

1. Credencial → Testar conexão
2. `OMIE_MOCK_MODE=false` → reiniciar app e worker
3. Sincronizar catálogo → sincronizar estoque
4. Vincular vendedores
5. Cadastrar o webhook (`docs/webhook-setup.md`)
