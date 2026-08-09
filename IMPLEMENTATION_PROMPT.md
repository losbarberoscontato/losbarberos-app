# Prompt inicial — próxima conversa Los Barberos

Estamos continuando o projeto **Los Barberos** em `D:\Display SH\Los Barberos`.

Assuma o volante técnico para investigar e implementar os próximos relatos de teste funcional ou visual. Preserve todos os dados existentes e diferencie sempre fluxo demo de fluxo conectado ao Supabase.

## Preflight obrigatório antes de editar

1. Leia integralmente `AGENTS.md`, `HANDOFF.md`, `README.md`, `IMPLEMENTATION_PROMPT.md` e `docs/architecture.md`.
2. Confirme `git status --short`, branch, remote e os últimos commits locais/remotos.
3. Confirme `npx.cmd supabase migration list --linked`.
4. Faça smoke HTTP em `https://losbarberos-app.vercel.app/entrar`.
5. Use código, migrations, testes e estado remoto verificado como fonte de verdade.
6. Nunca mostre chaves, tokens, cookies, headers `Authorization` ou secrets.

## Baseline publicado

- GitHub: `https://github.com/losbarberoscontato/losbarberos-app`, branch `main`.
- Commit publicado no preflight desta fase: `ec80d03`.
- Vercel: `https://losbarberos-app.vercel.app`.
- Supabase: projeto `Los Barberos`, ref `bwdjkhqshmppescunwer`.
- Migrations remotas sincronizadas até `202608090002`.
- Stripe Display SH permanece em Test mode; price `price_1U18IW0StL37D8g9quhZW9RN`; trial de 14 dias.
- Edge Functions Stripe permanecem na versão 5.

## Funcionalidades recentes que devem ser preservadas

- Serviços e pacotes com públicos Infantil, Feminino, Masculino e Outros Serviços.
- Edição de pacote substitui corretamente os serviços.
- Ativação/inativação de serviços e pacotes com filtros Ativos/Inativos.
- Clientes reais em modal de Novo cliente/Editar.
- Clientes com modal de histórico e última visita.
- Histórico de clientes mostra somente agendamentos `COMPLETED` com `net_paid_cents > 0`.
- Inativação de cliente exige motivo: Mudança de bairro, Mudança de cidade, Insatisfação, Perda de contato ou Outro motivo com texto livre.
- Motivo e data de inativação persistem em `customers.inactivation_reason` e `customers.inactivated_at`.
- Filtro Ativos/Inativos na tela Clientes.
- Clientes inativos não aparecem na busca de novo agendamento.
- Agenda conectada ao Supabase com visões Dia/Semana/Mês, filtros reais e intervalos de 15 minutos.
- Modal conectado de Novo agendamento no padrão da demo.
- Login sem credenciais preenchidas, mensagens temporárias e telefone com `+55` padrão.
- Tipografia ampliada para melhor legibilidade PWA/mobile.
- Caixa financeiro em avaliação local na branch `codex/caixa-financeiro`: contas, fornecedores, cadastros financeiros, lançamentos, liquidações, transferências e recebimentos vinculados a agendamentos.
- O Supabase já recebeu as migrations `202608090001_financial_cash.sql` e `202608090002_chart_account_templates.sql`, mas o código destas entregas ainda não foi enviado ao GitHub nem publicado na Vercel.
- No Caixa, `payment_transactions` permanece fonte de verdade dos pagamentos de agendamento. Demo não grava no Supabase; estorno manual reabre apenas o saldo financeiro e preserva o agendamento `COMPLETED`.
- Planos de conta padrão: template global com 42 contas do PDF de barbearia, copiado automaticamente para organizações criadas após `202608090002`. A substituição de um tenant só é permitida sem lançamentos financeiros vinculados.
- Caixa local: `202608090003_cash_default_account.sql` está pendente de autorização/aplicação remota. Ela cria a conta padrão tenant-safe `Caixa Físico`, o mapeamento `MANUAL/COUNTER` sem sobrescrever configuração existente e o campo `financial_accounts.description`.

## Regras de trabalho

- Investigue a causa antes de corrigir.
- Crie teste de regressão quando viável.
- Preserve dados cadastrados; migrations sempre incrementais e compatíveis.
- Não altere Stripe para Live mode.
- Mercado Pago, WhatsApp/Meta e Google Auth de clientes continuam fora do escopo.
- Não faça deploy, migration remota ou outra escrita externa sem autorização explícita nesta conversa.
- Quando a publicação for autorizada, conclua GitHub → Supabase → Vercel e apresente provas reais.

## Primeiro passo

Faça o preflight curto, informe o estado real de GitHub, Supabase e Vercel e aguarde meu primeiro relato de teste.
