# Handoff — Los Barberos

## Estado publicado — 09/08/2026

- Repositório: `https://github.com/losbarberoscontato/losbarberos-app`.
- Branch: `main`.
- Entrega funcional mais recente publicada: `acb57df` (`merge: refine local cash movement layout`).
- Vercel oficial: `https://losbarberos-app.vercel.app` — smoke `/entrar` HTTP 200.
- Supabase: projeto `Los Barberos`, ref `bwdjkhqshmppescunwer`, migrations sincronizadas até `202608090003`.
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

## Caixa financeiro — publicado em 09/08/2026

- Caixa financeiro enviado ao `main` e publicado automaticamente pela integração GitHub/Vercel. Status Vercel de `acb57df`: `success`; domínio oficial `/entrar`: HTTP 200.
- Migrations incrementais `202608090001_financial_cash.sql`, `202608090002_chart_account_templates.sql` e `202608090003_cash_default_account.sql` estão aplicadas e sincronizadas no Supabase.
- `202608090002_chart_account_templates.sql` mantém template global com 42 planos do PDF (12 receitas e 30 despesas) e provisiona o plano automaticamente para cada nova organização.
- Tenant `Barbearia Central`: os três planos sem lançamentos foram substituídos com autorização explícita. A validação remota confirmou 42 planos, 40 vínculos hierárquicos e nenhum plano legado.
- Caixa: recebimento de agendamento mostra status do ledger (`Recebido`) separado da conta financeira, tem colunas e período. Coluna principal é `Cliente/Fornecedor`: nome acima e descrição completa abaixo, com quebra de linha.
- `202608090003_cash_default_account.sql` adiciona descrição e conta padrão tenant-safe `Caixa Físico`, com mapeamento `MANUAL/COUNTER`, sem sobrescrever configuração existente.
- O schema inclui contas financeiras, fornecedores, plano de contas, centros de custo, tags, lançamentos, liquidações append-only, transferências atômicas e mapeamento de pagamentos de agendamento para conta financeira.
- O Caixa usa `payment_transactions` como fonte de verdade para agendamentos. Estorno manual cria reversal, preserva `COMPLETED` e reabre somente o saldo financeiro; estorno de provedor online continua no fluxo do provedor.
- Rotas: `/gestor/financeiro/caixa`, `/contas-pagar`, `/contas-receber`, `/bancos`, `/fornecedores` e `/cadastros`. Financeiro preserva visão geral e comissões.
- Demo mostra dados locais e bloqueia toda escrita no Supabase. A interface foi inspecionada localmente em modo demo: submenu, Caixa, modal, vínculo de agendamento, bancos/caixas e bloqueio de persistência.
- Validação local final do ajuste visual: ESLint, TypeScript e `next build` aprovados; teste focado de Caixa `7/7`. A pipeline GitHub do commit de publicação deve ser conferida no próximo preflight caso ainda não esteja concluída.

## Trabalho local não publicado — 11/08/2026

- Branch de trabalho: `codex/client-platform`; sem push ou deploy nesta fase.
- Migration `202608100001_client_global_identity.sql` aplicada e confirmada no Supabase remoto `bwdjkhqshmppescunwer`.
- `client_accounts` é a identidade global do cliente. Nome, telefone e nascimento são sincronizados de forma controlada para os clientes tenant vinculados; e-mail é gerenciado pelo Supabase Auth.
- O perfil do cliente salva apenas pela RPC `upsert_my_client_account`. A tela do gestor identifica `auth_user_id`, explica o bloqueio e permite editar somente observações de um cliente vinculado; inativação e reativação continuam tenant-local.
- Home conectada do cliente mostra a barbearia vinculada, CTA de agendamento e troca somente entre vínculos confirmados. Não mostra carteira ou saldo.
- Validação local desta etapa: testes focados `59/59` e TypeScript aprovados. Os gates completos e a verificação visual conectada ficam pendentes antes de qualquer publicação.
- Mercado Pago sandbox/produção, WhatsApp/Meta e e-mail transacional ainda não foram configurados ou validados nesta etapa.

## Regras para continuar

- Código, migrations, testes e estado remoto verificado são fonte de verdade.
- Preserve dados; migrations sempre incrementais e compatíveis.
- Investigue antes de corrigir e crie regressão quando viável.
- Nunca exiba chaves, tokens, cookies, `Authorization` ou secrets.
- Não execute escrita externa sem autorização explícita na conversa atual.
- Stripe permanece em Test mode; Mercado Pago, WhatsApp/Meta e Google Auth de clientes ficam fora do escopo.
