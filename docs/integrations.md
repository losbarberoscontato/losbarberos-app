# Integrações externas

Todas as credenciais são configuradas como secrets das Supabase Edge Functions. Não use variáveis `NEXT_PUBLIC_*` para chaves privadas.

## Stripe Billing

- Secret: `STRIPE_RESTRICTED_KEY`, com privilégios mínimos para Checkout, Billing e Customer Portal.
- Configuração: `STRIPE_PRICE_ID` e `STRIPE_WEBHOOK_SECRET`.
- Webhook: `/functions/v1/stripe-webhook`.
- Eventos: Checkout concluído, assinatura criada/alterada/cancelada, fatura paga e falha de pagamento.
- A versão do endpoint de webhook deve corresponder à versão fixada pelo Stripe SDK no código.
- Redirect de sucesso nunca ativa acesso. Somente o webhook chama a transição idempotente.

## Mercado Pago

- Secrets da aplicação: `MERCADO_PAGO_CLIENT_ID`, `MERCADO_PAGO_CLIENT_SECRET` e `MERCADO_PAGO_WEBHOOK_SECRET`.
- Callback OAuth: `/functions/v1/mercado-pago-oauth-callback`.
- Webhook: `/functions/v1/mercado-pago-webhook`.
- Cada tenant conecta a própria conta. Access e refresh tokens são gravados no Supabase Vault; o schema público guarda apenas IDs opacos.
- Checkout e refund usam chaves de idempotência derivadas por organização.

## WhatsApp Cloud API

- Secrets: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` e `WHATSAPP_GRAPH_API_VERSION`.
- Webhook: `/functions/v1/whatsapp-webhook`.
- `WHATSAPP_GRAPH_API_VERSION` é obrigatório para que upgrades sejam deliberados, não silenciosos.
- Templates devem existir e estar aprovados antes do sandbox end-to-end.
- A outbox usa lease, retry e idempotência. Ações de cancelamento usam tokens opacos, expirados e de uso único.

## Jobs

- `expire_stale_appointment_holds`
- `process_expired_billing_grace`
- `process_expired_organization_retention`
- `enqueue_due_whatsapp_reminders`
- `whatsapp-send-outbox`

Jobs SQL são seguros para concorrência por `FOR UPDATE SKIP LOCKED`. O sender da outbox roda como Edge Function autenticada pelo papel de serviço.

## Gate de ativação

Antes de produção, validar separadamente Stripe test mode, Mercado Pago sandbox e número de teste Meta. Registrar IDs de evento, transições no banco, retries e ausência de segredos nos logs.
