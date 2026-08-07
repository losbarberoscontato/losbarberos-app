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

## Regras para continuar

- Código, migrations, testes e estado remoto verificado são fonte de verdade.
- Preserve dados; migrations sempre incrementais e compatíveis.
- Investigue antes de corrigir e crie regressão quando viável.
- Nunca exiba chaves, tokens, cookies, `Authorization` ou secrets.
- Não execute escrita externa sem autorização explícita na conversa atual.
- Stripe permanece em Test mode; Mercado Pago, WhatsApp/Meta e Google Auth de clientes ficam fora do escopo.
