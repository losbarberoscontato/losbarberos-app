# Handoff — Los Barberos

## Estado atual

- Repositório: `https://github.com/losbarberoscontato/losbarberos-app`.
- Branch publicada: `main`.
- Vercel: `https://losbarberos-app.vercel.app`.
- Supabase: projeto `Los Barberos`, ref `bwdjkhqshmppescunwer`, região `ca-central-1`.
- Stripe: conta Display SH, modo Test, produto `Los Barberos — Plano completo`.
- Price público de teste: `price_1U18IW0StL37D8g9quhZW9RN`, R$ 59,90/mês.
- Trial de 14 dias nasce no Stripe Checkout; webhook confirmou o primeiro tenant como `TRIALING`.
- Primeiro tenant real de teste: `Barbearia Central`, unidade `Unidade principal`.

## Infra validada

- Vercel `/` e `/entrar` respondem HTTP 200.
- Supabase Auth por e-mail com confirmação e callback publicado.
- Variáveis públicas Supabase configuradas na Vercel.
- Migrations remotas `202608040001` até `202608040008` sincronizadas.
- Edge Functions Stripe ativas:
  - `stripe-create-checkout` — versão 5, JWT obrigatório.
  - `stripe-create-portal` — versão 5, JWT obrigatório.
  - `stripe-webhook` — versão 5, assinatura Stripe, sem JWT Supabase.
- Secrets Stripe/Supabase existem no cofre remoto; valores nunca devem ser impressos, enviados em chat ou commitados.
- Fluxo real validado: cadastro → confirmação de e-mail → tenant → Stripe Checkout Test → webhook → painel gestor `TRIALING`.

## Correções importantes já publicadas

- Agenda demo navega por data e mostra somente dados do dia selecionado.
- Busca/cadastro de cliente no novo agendamento.
- Novo agendamento demo aparece na agenda correta.
- Cadastro real de gestor via `signUp`/`signInWithPassword`.
- SQL das migrations 003 e 004 corrigido para aplicação remota.
- CORS das Edge Functions permite headers Supabase `x-client-info` e `apikey`.
- Metadados locais `supabase/.temp/` ignorados pelo Git.

## Verificação conhecida

- TypeScript aprovado.
- Vitest: 20 arquivos, 79 testes aprovados.
- Checkout Stripe Test abriu e concluiu com cartão de teste.
- Dashboard real abriu com dados zerados do novo tenant e status `TRIALING`.

## Escopo ainda fora

- Stripe Live mode.
- Mercado Pago da barbearia.
- WhatsApp/Meta.
- Google Auth para clientes.
- Publicação nas lojas Android/iOS.

## Regras para próximas correções

- Código, migrations, testes e estado remoto verificado são fonte de verdade.
- Preservar dados já cadastrados no Supabase; migrations sempre incrementais.
- Distinguir bug demo de bug do fluxo conectado antes de editar.
- Não expor chaves, tokens, cookies, headers Authorization ou secrets.
- Não aplicar nova migration, deploy ou escrita externa sem pedido explícito da conversa atual.
- Após mudança publicada: testar localmente, push em `main`, confirmar Supabase quando aplicável e smoke-check Vercel.

