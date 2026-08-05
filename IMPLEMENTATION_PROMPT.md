# Prompt para a próxima conversa — testes publicados Los Barberos

Estamos continuando o projeto **Los Barberos** em `D:\Display SH\Los Barberos`.

Quero iniciar a fase de testes funcionais e visuais no ambiente publicado. Assuma o volante técnico para diagnosticar e implementar as correções que eu relatar, preservando dados existentes.

Antes de editar:

1. Leia integralmente `AGENTS.md`, `HANDOFF.md`, `README.md` e `docs/architecture.md`.
2. Confirme `git status --short`, branch `main`, remote exclusivo `losbarberoscontato/losbarberos-app` e últimos commits.
3. Use código, migrations, testes e estado remoto verificado como fonte de verdade.
4. Diferencie sempre interface demo de interface conectada ao Supabase. Se uma correção já estiver correta no fluxo publicado, avise antes de gastar tempo alterando código.
5. Nunca mostre ou peça em chat chaves Stripe/Supabase, tokens, cookies ou Authorization.

Baseline remoto:

- GitHub: `https://github.com/losbarberoscontato/losbarberos-app`, branch `main`.
- Vercel: `https://losbarberos-app.vercel.app`.
- Supabase: `Los Barberos`, ref `bwdjkhqshmppescunwer`.
- Migrations `202608040001`–`202608040008` aplicadas.
- Stripe Display SH em Test mode, Price `price_1U18IW0StL37D8g9quhZW9RN`, trial de 14 dias.
- Edge Functions `stripe-create-checkout`, `stripe-create-portal` e `stripe-webhook` ativas na versão 5.
- Auth por e-mail e confirmação funcionando.
- Primeiro tenant real `Barbearia Central` criado; checkout concluído; status SaaS `TRIALING`; painel gestor acessível.
- Última verificação: TypeScript aprovado e 79 testes Vitest passando.

Correções críticas já feitas:

- SQL das migrations 003/004 corrigido.
- CORS Stripe corrigido para `x-client-info` e `apikey`.
- Cadastro/busca de clientes e criação/navegação de agendamentos na demo corrigidos.

Regras de trabalho:

- Investigue a causa antes de corrigir.
- Para bugs, crie teste de regressão quando viável.
- Migrations devem ser incrementais e não podem apagar dados cadastrados.
- Não considere o sistema em produção comercial: Vercel está publicado, Supabase é real, mas Stripe está em Test mode e MP/WhatsApp/Google Auth cliente seguem fora.
- Só faça migrations remotas, deploys ou outras escritas externas quando eu solicitar explicitamente nesta conversa.
- Quando eu pedir publicação, conclua GitHub → Supabase → Vercel e entregue evidência real.

Primeiro, faça um preflight curto do repositório e confirme se o ambiente continua saudável. Depois aguarde meu primeiro relato de teste.

