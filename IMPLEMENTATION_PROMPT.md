# Prompt inicial para a próxima conversa — Los Barberos

Estamos continuando o projeto **Los Barberos** em `D:\Display SH\Los Barberos`.

O sistema está em fase de testes funcionais e visuais no ambiente publicado. Assuma o volante técnico para diagnosticar e implementar as correções que eu relatar, sempre preservando os dados existentes.

Antes de editar:

1. Leia integralmente `AGENTS.md`, `HANDOFF.md`, `README.md`, `IMPLEMENTATION_PROMPT.md` e `docs/architecture.md`.
2. Confirme `git status --short`, branch `main`, remote `https://github.com/losbarberoscontato/losbarberos-app` e últimos commits locais/remotos.
3. Confirme o estado remoto com `npx.cmd supabase migration list --linked` e faça smoke HTTP da Vercel.
4. Use código, migrations, testes e estado remoto verificado como fonte de verdade.
5. Diferencie interface demo de interface conectada ao Supabase. Se algo relatado já estiver correto no fluxo publicado, avise antes de alterar código.
6. Nunca mostre chaves, tokens, cookies, headers `Authorization` ou secrets.

Baseline esperado após a publicação de 06/08/2026:

- GitHub: `https://github.com/losbarberoscontato/losbarberos-app`, branch `main`; confirme o hash publicado no preflight.
- Vercel: `https://losbarberos-app.vercel.app`.
- Supabase: projeto `Los Barberos`, ref `bwdjkhqshmppescunwer`.
- Migrations esperadas: `202608040001` até `202608040008`, `202608050001` e `202608060001` até `202608060004`.
- Stripe Display SH em Test mode.
- Price: `price_1U18IW0StL37D8g9quhZW9RN`.
- Trial: 14 dias.
- Edge Functions Stripe na versão 5.
- Cadastro, confirmação de e-mail, tenant `Barbearia Central`, checkout Test e status SaaS `TRIALING` já funcionavam.
- Última validação local desta fase: ESLint e TypeScript aprovados, 28 arquivos/107 testes Vitest aprovados, 36 E2E aprovados (2 ignorados) e build Next.js aprovado.

Entregas recentes que devem ser preservadas:

- Público Infantil/Feminino/Masculino/Outros Serviços para serviços e pacotes.
- Edição de pacote substitui serviços corretamente.
- Inativação/reativação e filtros Ativos/Inativos para serviços e pacotes.
- Login sem credenciais preenchidas.
- Mensagens informativas temporárias.
- Telefone com `+55` padrão quando não houver outro DDI.
- Badge diário real da Agenda e filtros de status em português.
- Data da agenda atualiza a listagem automaticamente.
- Intervalos de agenda fixos em 15 minutos no frontend e no banco.
- Agenda conectada no layout da demo, com dados reais e visões Dia/Semana/Mês.
- Modal conectado de novo agendamento no padrão da demo.

Regras de trabalho:

- Investigue a causa antes de corrigir.
- Crie teste de regressão quando viável.
- Preserve todos os dados cadastrados.
- Migrations devem ser incrementais e compatíveis.
- Stripe permanece em Test mode.
- Mercado Pago, WhatsApp e Google Auth de clientes continuam fora do escopo.
- Só faça deploy, migration remota ou outra escrita externa quando eu autorizar nesta conversa.
- Quando eu solicitar publicação, conclua GitHub → Supabase → Vercel e apresente provas reais.

Primeiro faça um preflight curto do repositório, confirme se GitHub, Supabase e Vercel continuam saudáveis e depois aguarde meu primeiro relato de teste.
