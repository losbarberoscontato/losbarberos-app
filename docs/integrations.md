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

## WhatsApp híbrido por barbearia

- Meta Cloud API usa `WHATSAPP_META_APP_ID`, `WHATSAPP_META_APP_SECRET`, `WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID`, `WHATSAPP_META_REDIRECT_URI`, `WHATSAPP_VERIFY_TOKEN` e `WHATSAPP_GRAPH_API_VERSION`.
- O token de cada WABA é recebido somente pela Edge Function e gravado no Supabase Vault; não existe token global de tenant no `.env`.
- QR Web usa `EVOLUTION_API_BASE_URL`, `EVOLUTION_API_KEY` e `EVOLUTION_WEBHOOK_SECRET`, sempre server-side/Vault, com aviso de canal não oficial.
- Callbacks Meta: `/functions/v1/whatsapp-embedded-signup-callback`; webhook: `/functions/v1/whatsapp-webhook`.
- Cada organização pode ter Meta e QR cadastrados, mas apenas um canal fica ativo. A conexão ativa é resolvida por `organization_id` na outbox; eventos Meta também conferem o `phone_number_id` recebido.
- Templates de confirmação e lembretes precisam existir e estar aprovados antes do sandbox end-to-end Meta.
- A outbox usa lease, retry e idempotência. Ações de cancelamento usam tokens opacos, expirados e de uso único.

### Gate externo

Para ativar o piloto, configurar os IDs não secretos no ambiente autorizado e os secrets no Vault/Edge Functions. Não enviar valores de segredo pelo chat. A configuração Meta também exige redirect URI, WABA/número de teste e templates utilitários aprovados; Evolution exige VPS Docker com HTTPS, persistência, callback assinado e monitoramento de sessão.

### Piloto QR Web — Hostinger KVM2

- O primeiro piloto de QR Web usará somente Los Barberos em uma VPS Hostinger KVM2 ou equivalente, com Ubuntu 24.04, Docker Engine e Docker Compose.
- O host expõe somente HTTPS por proxy reverso; Evolution API, persistência e dependências ficam em rede Docker privada, com volumes nomeados, backup e reinício automático.
- O DNS definitivo `losbarberos.com.br` ainda não está em operação. Enquanto isso, nenhuma URL, callback ou CORS deve depender do domínio futuro; a troca deve ocorrer apenas por variáveis de ambiente e configuração do proxy.
- Não iniciar uma conexão QR nem cadastrar `EVOLUTION_*` em produção antes da VPS, HTTPS, webhook assinado e persistência estarem validados. A Meta Cloud API continua sendo o canal oficial; QR Web deve ficar identificado como alternativa não oficial por tenant.

## Jobs

- `expire_stale_appointment_holds`
- `process_expired_billing_grace`
- `process_expired_organization_retention`
- `enqueue_due_whatsapp_reminders`
- `whatsapp-send-outbox`

Jobs SQL são seguros para concorrência por `FOR UPDATE SKIP LOCKED`. O sender da outbox roda como Edge Function autenticada pelo papel de serviço.

## Gate de ativação

Antes de produção, validar separadamente Stripe test mode, Mercado Pago sandbox e número de teste Meta. Registrar IDs de evento, transições no banco, retries e ausência de segredos nos logs.
