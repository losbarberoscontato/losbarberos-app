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
- Migrations `202608100001_client_global_identity.sql` e `202608110001_client_counter_booking_availability.sql` aplicadas e confirmadas no Supabase remoto `bwdjkhqshmppescunwer`.
- `client_accounts` é a identidade global do cliente. Nome, telefone e nascimento são sincronizados de forma controlada para os clientes tenant vinculados; e-mail é gerenciado pelo Supabase Auth.
- O perfil do cliente salva apenas pela RPC `upsert_my_client_account`. A tela do gestor identifica `auth_user_id`, explica o bloqueio e permite editar somente observações de um cliente vinculado; inativação e reativação continuam tenant-local.
- Home conectada do cliente mostra a barbearia vinculada, CTA de agendamento e troca somente entre vínculos confirmados. Não mostra carteira ou saldo.
- Novos agendamentos de cliente usam somente `COUNTER`: ficam `CONFIRMED`, com snapshots de sinal zerados e pagamento integral no atendimento. A agenda aceita hoje até hoje + 15 dias e também lista horários disponíveis por data antes da escolha do profissional.
- Validação local desta etapa: suíte de identidade `113/113`, lint, TypeScript, Vitest completo e build aprovados; smoke de produção local `/cliente/entrar`: HTTP 200. Verificação visual autenticada conectada fica pendente antes de qualquer publicação.
- Mercado Pago sandbox/produção, WhatsApp/Meta e e-mail transacional ainda não foram configurados ou validados nesta etapa.

## Entrega de acesso, agenda e recebimento — 11/08/2026

- A entrega foi integrada na `main` e o push foi confirmado. O domínio Vercel respondeu HTTP 200; deploy direto pela CLI ficou `PENDENTE` por autorização Vercel recusada.
- Ao concluir atendimento `COUNTER`, a agenda abre a boleta de recebimento; cancelar mantém o atendimento concluído e o saldo `UNPAID`.
- `Contas a receber` projeta atendimentos `COMPLETED` com saldo aberto e oferece `Receber`; a confirmação usa exclusivamente `payment_transactions`.
- A boleta preenche cliente, serviço/profissional, valor, datas, plano `1 · Receitas`, conta mapeada `MANUAL/COUNTER`, documento `ATD-<id>` e guarda os campos em metadados auditáveis.
- Não é criado `financial_entry` ou `financial_settlement` para pagamento de agendamento; isso evita dupla contagem no Caixa.
- Migration `202608110003_appointment_receipt_metadata.sql` aplicada e sincronizada no Supabase remoto `bwdjkhqshmppescunwer`.
- Validação local final: `npm.cmd run verify` aprovado; Vitest `41` arquivos / `227` testes; smoke local sem sessão autenticada respondeu `307` nas rotas protegidas.

## Regras para continuar

- Código, migrations, testes e estado remoto verificado são fonte de verdade.
- Preserve dados; migrations sempre incrementais e compatíveis.
- Investigue antes de corrigir e crie regressão quando viável.
- Nunca exiba chaves, tokens, cookies, `Authorization` ou secrets.
- Não execute escrita externa sem autorização explícita na conversa atual.
- Stripe permanece em Test mode; Mercado Pago, WhatsApp/Meta e Google Auth de clientes ficam fora do escopo.

## Páginas legais públicas para Meta — 12/08/2026

- Implementação isolada na branch `codex/legal-meta-release`, sem migration ou escrita no Supabase.
- Rotas públicas versão `1.0`: `/privacidade`, `/termos` e `/exclusao-de-dados`.
- Responsável público: `JULIO CESAR HEIDEN JUNIOR 05128841960`; contato LGPD: `contato@losbarberos.com.br`.
- Origem canônica centralizada em `NEXT_PUBLIC_SITE_URL`. Valor atual: `https://losbarberos-app.vercel.app`; no corte de DNS, alterar para `https://losbarberos.com.br`.
- Ícone oficial exportado em `public/icon-1024.png` e referenciado no manifesto.
- Conteúdo jurídico é uma versão genérica baseada na LGPD e ainda depende da revisão final do advogado. Não declarar aprovação jurídica ou aprovação da Meta sem prova posterior.
- Validação local antes da publicação: testes focados `8/8`, suíte serial `43` arquivos / `235` testes, ESLint, TypeScript, build Next.js e inspeção visual desktop/mobile aprovados.
- GitHub, CI, Vercel e URLs públicas desta entrega permanecem `PENDENTE` até o commit e a verificação remota do SHA publicado.
