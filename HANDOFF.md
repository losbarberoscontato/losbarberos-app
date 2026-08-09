# Handoff — Los Barberos

## Estado publicado — 07/08/2026

- Repositório: `https://github.com/losbarberoscontato/losbarberos-app`.
- Branch: `main`.
- Commit mais recente publicado: `ec80d03`.
- Vercel oficial: `https://losbarberos-app.vercel.app` — smoke `/entrar` HTTP 200.
- Supabase: projeto `Los Barberos`, ref `bwdjkhqshmppescunwer`, migrations sincronizadas até `202608060005`.
- Stripe: Display SH em Test mode, price `price_1U18IW0StL37D8g9quhZW9RN`, trial de 14 dias.
- Tenant real de teste preservado: `Barbearia Central`.

## Entregas preservadas

- Catálogo com públicos, edição correta de pacotes e ativação/inativação tenant-safe.
- Clientes em modais de cadastro/edição.
- Histórico do cliente com dados básicos, última visita e agendamentos pagos concluídos.
- Inativação de cliente com motivo persistido em `customers.inactivation_reason` e data em `customers.inactivated_at`.
- Filtros Ativos/Inativos em Clientes.
- Clientes inativos excluídos da busca de novos agendamentos.
- Agenda conectada: Dia/Semana/Mês, filtros reais, badge diário, data reativa e slots de 15 minutos.
- Login sem credenciais demo, mensagens temporárias, telefone padrão `+55` e tipografia ampliada.

## Verificações desta fase

- Suíte Vitest aprovada.
- ESLint aprovado.
- TypeScript aprovado.
- Build Next.js aprovado.
- Migration `202608060005_customer_inactivation_reason.sql` aplicada e schema confirmado.
- GitHub `origin/main` confirmado em `ec80d03`.
- Vercel deployment manual `dpl_7iuPC5MEY2Mha2THeNwdR57GHg1d` ficou `Ready`; o domínio oficial respondeu HTTP 200 após o push.

## Caixa financeiro — avaliação local em 09/08/2026

- Implementação isolada em `D:\Display SH\Los Barberos-caixa-financeiro`, branch local `codex/caixa-financeiro`, baseada no commit local `0288023`; nenhuma alteração desta entrega foi enviada ao GitHub ou Vercel.
- Migration incremental `202608090001_financial_cash.sql` foi aplicada ao Supabase autorizado nesta conversa. `npx.cmd supabase migration list --linked` confirmou `202608090001` igual local/remoto.
- Migration incremental `202608090002_chart_account_templates.sql` foi aplicada ao Supabase autorizado. Ela mantém template global com 42 planos do PDF (12 receitas e 30 despesas) e provisiona o plano automaticamente para cada nova organização.
- Tenant `Barbearia Central`: os três planos sem lançamentos foram substituídos com autorização explícita. A validação remota confirmou 42 planos, 40 vínculos hierárquicos e nenhum plano legado.
- O schema inclui contas financeiras, fornecedores, plano de contas, centros de custo, tags, lançamentos, liquidações append-only, transferências atômicas e mapeamento de pagamentos de agendamento para conta financeira.
- O Caixa usa `payment_transactions` como fonte de verdade para agendamentos. Estorno manual cria reversal, preserva `COMPLETED` e reabre somente o saldo financeiro; estorno de provedor online continua no fluxo do provedor.
- Rotas locais: `/gestor/financeiro/caixa`, `/contas-pagar`, `/contas-receber`, `/bancos`, `/fornecedores` e `/cadastros`. Financeiro preserva visão geral e comissões.
- Demo mostra dados locais e bloqueia toda escrita no Supabase. A interface foi inspecionada localmente em modo demo: submenu, Caixa, modal, vínculo de agendamento, bancos/caixas e bloqueio de persistência.
- Validação desta entrega: Vitest `32/32` arquivos e `123/123` testes, ESLint, TypeScript e `next build` aprovados; smoke da produção `/entrar` HTTP 200. Não houve deploy.

## Regras para continuar

- Código, migrations, testes e estado remoto verificado são fonte de verdade.
- Preserve dados; migrations sempre incrementais e compatíveis.
- Investigue antes de corrigir e crie regressão quando viável.
- Nunca exiba chaves, tokens, cookies, `Authorization` ou secrets.
- Não execute escrita externa sem autorização explícita na conversa atual.
- Stripe permanece em Test mode; Mercado Pago, WhatsApp/Meta e Google Auth de clientes ficam fora do escopo.
