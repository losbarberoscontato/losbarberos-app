# Los Barberos

SaaS brasileiro multi-tenant para gestão de barbearias. Next.js PWA no frontend; Supabase/PostgreSQL no backend; Stripe Billing, Mercado Pago e WhatsApp atrás de funções server-side.

## Estado local

- Ambiente Demo está desabilitado. Sem Supabase configurado, rotas operacionais retornam à entrada com erro explícito.
- Schema, RLS, RPCs e Edge Functions ficam em `supabase/`.
- Nenhuma integração externa é chamada sem variáveis explícitas.
- Produção não está configurada nem publicada.

## Requisitos

- Node.js 24+
- npm 11+
- Docker somente para executar Supabase local

## Rodar

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`. Rotas principais:

- `/` — entrada do produto
- `/login` — autenticação por e-mail ou Google
- `/gestor` — workspace do gestor
- `/agendar` — PWA do cliente
- `/admin` — controle mínimo da plataforma
- `/regularizacao` — recuperação de cobrança

## Validação

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:e2e
```

Para validar o service worker em servidor de produção local: `$env:PWA_E2E='1'; npm run test:e2e` (PowerShell). O E2E usa a porta 3100 para evitar colisão com outros servidores.

## Configuração

Copie `.env.example` para `.env.local` e preencha somente ambientes sandbox. Segredos Stripe, Mercado Pago e WhatsApp nunca usam prefixo `NEXT_PUBLIC_`.

Para Supabase local, após instalar Docker:

```bash
npx supabase start
npx supabase db reset
```

## Segurança

- Identidade por `auth.users.id`, nunca por e-mail.
- Toda entidade comercial possui `organization_id` e RLS.
- Escritas críticas passam por RPC/Edge Function.
- Webhooks validam assinatura e idempotência.
- Dinheiro usa centavos inteiros; ledgers são append-only.
- Service worker não cacheia navegação, APIs, auth ou dados privados.

Detalhes: [arquitetura](docs/architecture.md), [segurança](docs/security.md), [QA](docs/qa.md), [Google OAuth](docs/google-oauth-setup.md) e [Módulo WhatsApp Evolution](docs/whatsapp-evolution-module.md).

## Módulos de integração

- Para qualquer manutenção do fluxo WhatsApp via QR/Evolution API, trate-o como **Módulo WhatsApp Evolution** e leia [sua documentação técnica](docs/whatsapp-evolution-module.md) antes de mudar código, migrations, jobs, webhooks ou infraestrutura.
- O **Módulo WhatsApp Meta** é distinto. Não reutilize contratos, filas, segredos ou comportamentos do Evolution nele.
