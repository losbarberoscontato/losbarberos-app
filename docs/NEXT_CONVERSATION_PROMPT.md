# Prompt inicial — próxima conversa Los Barberos

Estamos continuando o projeto Los Barberos em `D:\Display SH\Los Barberos`.

Assuma o volante técnico para investigar e implementar os próximos relatos de teste funcional ou visual. Preserve dados existentes, mantenha tenant scope e diferencie sempre demo de fluxo conectado ao Supabase.

## Preflight obrigatório

1. Leia `AGENTS.md`, `HANDOFF.md`, `README.md`, `IMPLEMENTATION_PROMPT.md` e `docs/architecture.md`.
2. Confirme `git status --short`, branch, remote, SHA de `origin/main` e commits locais/remotos.
3. Confirme `npx.cmd supabase migration list --linked`.
4. Faça smoke em `https://losbarberos-app.vercel.app/entrar`.
5. Use código, migrations, testes e estado remoto verificado como fonte de verdade.
6. Nunca exponha secrets, tokens, cookies ou headers de autorização.

## Baseline atual

- GitHub: `https://github.com/losbarberoscontato/losbarberos-app`, branch `main`.
- Vercel: `https://losbarberos-app.vercel.app`.
- Supabase ref: `bwdjkhqshmppescunwer`, migrations até `202608110003`.
- `payment_transactions` é a fonte única de verdade para pagamentos de agendamento.
- Demo nunca grava no Supabase.
- Conta padrão `Caixa Físico` e mapeamento `MANUAL/COUNTER` existem sem sobrescrever configurações.

## Entregas preservadas

- Cliente global com vínculo confirmado a barbearias e bloqueio de edição canônica pelo gestor.
- Home conectada do cliente, cadastro/login, agenda `COUNTER`, escolha por data, horário e barbeiro.
- Filtros de Serviços/Pacotes e disponibilidade bidirecional por horário/profissional.
- Agenda do gestor com iniciar/concluir atendimento e comissões preservadas.
- Caixa financeiro com contas, fornecedores, planos, centros, tags, lançamentos, liquidações, transferências e recebimentos vinculados.
- Ao concluir atendimento `COUNTER`, abre boleta de recebimento; cancelar mantém `UNPAID`.
- `Contas a receber` projeta atendimentos concluídos com saldo aberto e botão `Receber`.
- A boleta guarda cliente, descrição, valor, datas, plano, conta, documento e tags em metadados da transação, sem criar lançamento financeiro duplicado.
- Carteira interna, sinal e Mercado Pago para pagamento antecipado continuam fora do escopo.

## Próximo passo

Aguarde o relato funcional/visual do usuário. Investigue a causa antes de corrigir, crie regressão quando viável e peça autorização explícita antes de novas migrations remotas, pushes ou deploys.
