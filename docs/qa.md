# QA

## Automatizado

- Unitário: dinheiro, agenda, cancelamento, reagendamento, comissão, acesso e retenção.
- Integração SQL: RLS, FKs tenant-scoped, transições, idempotência e GiST concorrente.
- Contratos: assinaturas e mapeamentos de Stripe, Mercado Pago e WhatsApp.
- E2E: desktop gestor, mobile cliente, platform admin, regularização e offline seguro.

## Gates externos

- Google OAuth com redirects de preview e produção.
- Stripe sandbox: Checkout trial, portal, `invoice.paid`, falha e retry.
- Mercado Pago sandbox: OAuth, sinal, integral, webhook tardio e refund.
- Meta: template aprovado, opt-in, entrega, cancelamento em dois passos e opt-out.
- Supabase remoto: migrations, RLS e RPCs aplicadas.
- Vercel: build, headers, domínio e variáveis por ambiente.

Sem essas provas, resultado é local/sandbox; não produção.

