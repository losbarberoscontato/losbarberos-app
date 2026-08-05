# Arquitetura

## Fronteiras

- Next.js/Vercel: UI, rotas públicas, callback Google e sessões.
- PostgreSQL: invariantes, RLS, disponibilidade, agenda, estados e ledgers.
- Supabase Edge Functions: Stripe, Mercado Pago, WhatsApp, OAuth e webhooks.
- Supabase Cron: expiração de holds, carência, outbox e retenção.

O navegador pode ler apenas dados permitidos por RLS. Preços, estados, pagamentos, comissão e ações administrativas nunca confiam no payload do cliente.

## Dados

- UUID em todas as chaves.
- `organization_id` em dados de negócio; FKs compostas evitam referências cruzadas.
- `timestamptz` para instantes; `time` local para jornada; timezone IANA na unidade.
- `bigint` em centavos e basis points inteiros.
- `jsonb` somente para payload externo sanitizado ou snapshot auxiliar.
- Segredos ficam em Vault/variáveis server-side.

## Agenda

Disponibilidade exibida é informativa. Escrita final usa transação e constraint de exclusão GiST em `tstzrange`. Holds duram dez minutos. Estados que ocupam agenda não podem sobrepor para mesmo tenant, unidade e barbeiro.

Serviços preservam duração real e ocupação arredondada para grade de quinze minutos. Reagendamento segura novo slot antes de liberar o anterior.

## Financeiro

Stripe cobra assinatura Los Barberos. Mercado Pago cobra cliente final na conta OAuth da barbearia. Os dois domínios nunca compartilham ledger.

Redirect não confirma pagamento. Webhook assinado e idempotente registra evento, confere valor/moeda no provedor e chama transição transacional. Refund falho vira pendência operacional.

## PWA e futuro mobile

PWA exige rede para auth, agenda e financeiro. Cache contém apenas assets públicos versionados. Domínio e integrações ficam fora dos componentes para permitir wrapper Capacitor futuro. Build iOS permanece não validável neste Windows.

