# QA

## Automatizado

- Unitário: dinheiro, agenda, cancelamento, reagendamento, comissão, acesso e retenção.
- Integração SQL: RLS, FKs tenant-scoped, transições, idempotência e GiST concorrente.
- Contratos: assinaturas e mapeamentos de Stripe, Mercado Pago e WhatsApp.
- E2E: desktop gestor, mobile cliente, platform admin, regularização e offline seguro.

## Gates externos

- Google OAuth com redirects de preview e produção.
- Stripe sandbox: Checkout trial, portal, `invoice.paid`, falha e retry.
- Mercado Pago sandbox: OAuth, pagamento integral, webhook tardio e refund. Carteira e sinal não fazem parte do fluxo novo.
- Meta: template aprovado, opt-in, entrega, cancelamento em dois passos e opt-out.
- Supabase remoto: migrations, RLS e RPCs aplicadas.
- Vercel: build, headers, domínio e variáveis por ambiente.

Sem essas provas, resultado é local/sandbox; não produção.

## Acesso global de cliente — 11/08/2026

- Local: `tests/domain/client-auth.test.ts`, `tests/integrations/client-global-identity-migration.test.ts`, `tests/integrations/oauth-callback.test.ts`, `tests/ui/client-connected-api.test.tsx`, `tests/ui/client-connected.test.tsx` e `tests/ui/manager-connected.test.tsx`: `113/113` aprovados.
- Local: lint, TypeScript, Vitest completo e build Next.js aprovados; smoke de `http://localhost:3000/cliente/entrar`: HTTP 200.
- Supabase remoto: migrations `202608100001_client_global_identity.sql` e `202608110001_client_counter_booking_availability.sql` foram aplicadas e listadas como sincronizadas em `bwdjkhqshmppescunwer`. Não equivale a validação funcional autenticada de RLS/RPCs.
- Agenda cliente: validar conectado a escolha por data/profissional, a janela de hoje até hoje + 15 dias, a reserva `COUNTER` confirmada e a ausência de sinal, carteira e checkout.
- E-mail transacional, entrega de confirmação/recovery e jornada autenticada conectada permanecem `NÃO VALIDADO` sem ambiente de teste controlado.
- Produção: o smoke público de `https://losbarberos-app.vercel.app/entrar` respondeu HTTP 200 no preflight. Esta branch não foi enviada nem implantada; a nova funcionalidade não está validada em produção.


## Recebimento de atendimento — 11/08/2026

- `npm.cmd run verify`: lint, typecheck, Vitest completo (`41` arquivos / `227` testes) e build aprovados.
- Migration remota `202608110003_appointment_receipt_metadata.sql` aplicada e sincronizada.
- Teste automatizado cobre abertura da boleta em `Contas a receber`, preenchimento do atendimento e chamada exclusiva de `record_manual_appointment_receipt`.
- Validação visual autenticada conectada do recebimento ainda deve ser repetida após o deploy; smoke HTTP sem sessão autentica apenas o redirecionamento `307`.
