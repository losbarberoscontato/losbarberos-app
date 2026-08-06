# Handoff — Los Barberos

## Estado desta entrega — 06/08/2026

- Repositório: `https://github.com/losbarberoscontato/losbarberos-app`.
- Branch de produção: `main`.
- Vercel: `https://losbarberos-app.vercel.app`.
- Supabase: projeto `Los Barberos`, ref `bwdjkhqshmppescunwer`, região `ca-central-1`.
- Stripe: conta Display SH em Test mode, Price `price_1U18IW0StL37D8g9quhZW9RN`, trial de 14 dias.
- Tenant real de teste preservado: `Barbearia Central`.
- Commit funcional que encerrou a fase local: `001e797`.
- O commit exato publicado deve ser confirmado com `git log -1 --oneline origin/main` no próximo preflight.

## Entregas desta fase

### Serviços e pacotes

- Campo `Público` para serviços e pacotes: Infantil, Feminino, Masculino e Outros Serviços.
- Pacotes passam a substituir corretamente os serviços selecionados na edição, sem somar seleções antigas.
- Inativação e reativação de pacotes por RPC tenant-safe, com confirmação.
- Inativação e reativação de serviços por RPC tenant-safe, com confirmação.
- Filtros Ativos/Inativos independentes dentro dos cards Serviços e Pacotes.
- Serviços e pacotes inativos ficam preparados para não aparecer no fluxo do cliente.

### Login, mensagens e clientes

- Credenciais de demonstração removidas dos campos da tela de login.
- Mensagens informativas passam a desaparecer automaticamente.
- Campo `Telefone E.164` renomeado para `Telefone`.
- Telefones sem DDI são gravados com `+55`; DDI informado pelo usuário é preservado.

### Agenda conectada

- Badge da Agenda representa o total de agendamentos do dia e mostra `0` quando vazio.
- Filtros de status traduzidos e conectados aos status reais.
- Seleção de data atualiza automaticamente os agendamentos exibidos.
- Horários de criação e reagendamento usam intervalos de 15 minutos.
- Validação de alinhamento do horário existe no cliente e no banco.
- Layout conectado foi alinhado à agenda demo, sem copiar dados demonstrativos.
- Visões Dia, Semana e Mês funcionam com os agendamentos carregados do Supabase.
- Filtros por profissional e status atuam nas três visões.
- `Novo agendamento` abre modal no padrão visual da demo e continua usando a RPC real `create_manual_appointment`.
- Detalhes e ações existentes foram preservados: confirmar sem pagamento, iniciar, concluir, reagendar, marcar não comparecimento e cancelar.
- O nome do serviço vem do snapshot de `appointment_items`.

## Banco e migrations

- Migrations incrementais desta fase:
  - `202608050001_catalog_audiences.sql`
  - `202608060001_package_activation_rpc.sql`
  - `202608060002_allow_package_reactivation.sql`
  - `202608060003_service_activation_rpc.sql`
  - `202608060004_slot_interval_15_minutes.sql`
- Antes do fechamento remoto, o Supabase estava sincronizado até `202608060003`; a `202608060004` era a única pendente.
- O fechamento desta entrega deve aplicar e confirmar todas até `202608060004`.
- Todas são incrementais; nenhum reset ou exclusão de dados foi autorizado ou executado.

## Verificação local

- `npm.cmd run verify` aprovado.
- ESLint aprovado sem erros.
- TypeScript aprovado.
- Vitest: 28 arquivos e 107 testes aprovados.
- Playwright E2E em build de produção: 36 testes aprovados e 2 ignorados por escopo.
- Build Next.js 16.3.0 aprovado, 22 páginas geradas.
- QA visual das visões Dia/Semana/Mês e do modal concluído em preview local estruturado.
- A validação visual autenticada contra o Supabase publicado continua sendo feita pelo usuário no ambiente de testes.

## Infra preservada

- Supabase Auth por e-mail e confirmação funcionando.
- Fluxo real já validado: cadastro → confirmação → tenant → Stripe Checkout Test → webhook → gestor `TRIALING`.
- Edge Functions Stripe permanecem na versão 5.
- Stripe continua em Test mode.

## Fora do escopo atual

- Stripe Live mode.
- Mercado Pago da barbearia.
- WhatsApp/Meta.
- Google Auth para clientes.
- Publicação nas lojas Android/iOS.

## Regras para continuar

- Código, migrations, testes e estado remoto verificado são fonte de verdade.
- Preservar todos os dados existentes; migrations sempre incrementais.
- Diferenciar interface demo de interface conectada ao Supabase antes de corrigir.
- Investigar a causa e criar teste de regressão quando viável.
- Nunca exibir chaves, tokens, cookies, `Authorization` ou secrets.
- Não executar migration remota, deploy ou outra escrita externa sem autorização explícita na conversa atual.
- Quando houver publicação autorizada, concluir e comprovar GitHub → Supabase → Vercel.
