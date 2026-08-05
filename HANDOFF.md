# Handoff — Los Barberos

## Objetivo

MVP SaaS multi-tenant para barbearias brasileiras: gestor web, cliente PWA, platform admin, agenda segura, pagamentos, billing, WhatsApp, comissão e relatórios.

## Baseline

- Branch de implementação: `feat/los-barberos-mvp`.
- Stack: Next.js 16, React 19, TypeScript, Supabase e Vitest/Playwright.
- Sem remote Git, projeto Supabase, deploy ou credenciais externas configurados.
- Docker ausente nesta máquina; migration local real fica pendente até Docker/Supabase local ou projeto autorizado.
- Gates locais verificados: lint, typecheck, build, audit, 72 testes Vitest e 36 E2E aprovados; 2 cenários conectados ficam pulados sem tenant Supabase.
- E2E com PWA real usa `PWA_E2E=1` e servidor isolado na porta 3100.

## Fonte de verdade

- `supabase/migrations/` — dados, RLS, constraints e RPCs.
- `supabase/functions/` — integrações externas.
- `src/lib/domain/` — políticas puras testáveis.
- `src/app/` e `src/components/` — produto web/PWA.
- `docs/` — arquitetura, segurança e QA.

## Stop rules

- Não aplicar migrations remotas nem publicar sem autorização.
- Não inventar validação de sandbox/produção.
- Credenciais são gate externo; nunca pedir para colar segredos em chat.
