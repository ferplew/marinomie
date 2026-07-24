# Configuração de Webhook da Omie

## Antes de começar

Confirme dois pontos que a documentação pública da Omie **não** cobre e que
afetam esta configuração (`docs/known-limitations.md` §1, itens 1 e 2):

1. **A lista de tópicos disponíveis** só aparece dentro do portal do
   desenvolvedor autenticado, na tela de cadastro do webhook.
2. **Não existe assinatura HMAC.** Isso muda o modelo de segurança: o token na
   URL é a única autenticação, então **a URL inteira é um segredo**.

## Passo a passo

1. Configure a credencial em **Admin → Integrações** (`app_key`/`app_secret`).
   O token do webhook é gerado nesse momento.
2. Vá em **Admin → Webhooks** e copie a URL. Ela tem o formato:
   `https://SEU_DOMINIO/api/webhooks/omie/{organizationId}/{token}`
3. No portal do desenvolvedor Omie, abra seu aplicativo → **Adicionar novo
   webhook** → cole a URL → selecione os eventos → Salvar.
4. A Omie envia uma notificação de teste. Ela aparece em **Admin → Webhooks**.
   Se o payload não tiver identificador reconhecível, o evento fica como
   `UNHANDLED` — isso é esperado e não é erro.
5. **Copie a lista de eventos que você viu no portal** para
   `docs/omie-api-mapping.md` §10. É a informação que falta para escrever
   handlers específicos.

> Alterações de webhook só valem para novas sessões do Omie. Recarregue o app
> antes de testar.

## O que o endpoint faz

```
POST /api/webhooks/omie/{organizationId}/{token}
  → valida organização + token (comparação em tempo constante)
  → persiste o payload BRUTO antes de qualquer interpretação
  → enfileira o processamento
  → responde 200 em milissegundos
```

A Omie espera resposta em **até 7 segundos** e repete 3 vezes antes de mandar
para a DLQ dela (retentativas por até 5 dias). Por isso o handler não processa
nada de forma síncrona.

### Respostas

| Situação | HTTP | Motivo |
|---|---|---|
| Evento aceito | 200 `accepted` | Enfileirado |
| Payload idêntico já recebido | 200 `duplicate` | Devolver erro faria a Omie repetir um evento que já temos |
| Integração pausada | 200 `ignored` | Evita reenvio infinito enquanto o admin resolve |
| Token inválido ou organização inexistente | 404 | Resposta idêntica nos dois casos, para não permitir enumerar organizações |
| Corpo não-JSON | 400 | Repetir não resolveria |
| Falha nossa ao registrar | 500 | Aqui **queremos** que a Omie repita |

## Por que o payload nunca é aplicado direto

O worker trata o evento como **gatilho**, não como fonte: ao receber
"produto alterado", ele consulta `ConsultarProduto` e `ObterEstoqueProduto` para
saber o estado atual. Isso protege contra evento fora de ordem, payload
incompleto e — na ausência de assinatura — payload forjado por quem descobrir a
URL.

## Rotação do token

Substituir a credencial em **Admin → Integrações** preserva o token do webhook
de propósito: regenerá-lo silenciosamente quebraria a configuração já feita no
portal. Para rotacionar o token, será necessário recadastrar a URL na Omie —
funcionalidade ainda não exposta na interface.

## Diagnóstico

- **Nenhum evento chegando:** confirme que a URL está acessível publicamente
  (a Omie precisa alcançar seu domínio) e que a credencial está ativa.
- **Eventos como `UNHANDLED`:** o payload não tem identificador conhecido. Veja
  os tópicos observados no painel e abra uma tarefa para o handler específico.
- **Eventos como `FAILED`:** o campo de erro mostra a causa. Costuma ser
  credencial inválida ou indisponibilidade da Omie na consulta complementar.
- **Nada saindo de `RECEIVED`:** provavelmente não há worker rodando
  (`npm run worker`).
