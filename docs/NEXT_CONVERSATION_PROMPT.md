# Prompt inicial — próxima conversa Los Barberos

Continuar projeto Los Barberos em `D:\Display SH\Los Barberos`.

Projeto SaaS Next.js multi-tenant conectado ao Supabase remoto. Comunicação e produto em PT-BR. Código, migrations, testes e documentação são fonte de verdade; não use apenas contexto de chat.

## Ambiente local obrigatório

```powershell
cd "D:\Display SH\Los Barberos"
npm.cmd run dev
```

- Use `.env.local` existente: sem configuração Supabase, app entra em demo e não prova fluxo conectado.
- Não subir Evolution API, Docker ou serviços WhatsApp locais. Preserve Evolution/VPS/Edge Functions de produção.
- Se porta `3000` já estiver em uso por outro `next dev` deste projeto, use servidor existente; não finalize processo sem autorização.
- No Windows use `npm.cmd` e `npx.cmd`.

## Preflight obrigatório

1. Leia `AGENTS.md`, `README.md`, `HANDOFF.md`, `IMPLEMENTATION_PROMPT.md`, `docs/architecture.md`, `docs/whatsapp-evolution-module.md` e este arquivo.
2. Confirme `git status --short`, branch, SHA local, `origin/main` e mudanças não relacionadas antes de editar.
3. Confirme migrations com `npx.cmd supabase migration list --linked`.
4. Para WhatsApp, confirme functions com `npx.cmd supabase functions list --project-ref bwdjkhqshmppescunwer`.
5. Smoke público: `curl.exe -sS -o NUL -w "%{http_code}" https://losbarberos-app.vercel.app`.
6. Nunca exponha secrets, tokens, senhas, cookies, `Authorization` headers ou chaves.

## Sistemas conectados

- GitHub: `https://github.com/losbarberoscontato/losbarberos-app`.
- Branch de produção: `main`.
- Supabase ref: `bwdjkhqshmppescunwer`.
- Vercel scope: `losbarberoscontatos-projects`; projeto: `losbarberos-app`; URL: `https://losbarberos-app.vercel.app`.
- Migrations remotas sincronizadas até `20260821145726`.
- `whatsapp-v2-dispatcher` está ativo remotamente na versão 13.

## Regras de segurança e produto

- Todo dado comercial exige `organization_id`; nunca criar leitura/escrita cross-tenant.
- Dinheiro em centavos inteiros; percentuais em basis points.
- Agenda, pagamentos, billing e comissão devem ser atômicos e idempotentes.
- Ledgers/eventos são append-only: corrigir com reversal/adjustment, nunca apagar histórico.
- `payment_transactions` continua fonte única de verdade de pagamentos de agendamento.
- Não aplicar migration, function, push ou deploy sem autorização explícita nesta nova conversa.
- HTTP 200, `SUBMITTED` ou provider 201 não provam entrega de WhatsApp: diferenciar webhook, persistência, outbox, provider e recebimento real.

## Entregas concluídas

### WhatsApp Evolution

- Documentação do módulo: `docs/whatsapp-evolution-module.md`; conexão Evolution API é distinta do futuro módulo WhatsApp Meta, ainda não implementado.
- Respostas `1`, `2` e `3`/inválidas dos lembretes T-45 e 8h atualizam agenda, respectivamente, para `Confirmado`, `Cancelado - horário liberado` e `Solicitado Contato`.
- Confirmação manual dispara comunicação ao cliente/barbeiro e grava `Confirmado Manualmente`.
- Cards da agenda e reservas do cliente usam status operacional coerente: agendado/azul, confirmado/verde, cancelado/vermelho, solicitado contato/roxo e confirmado manualmente/verde claro.
- Regra anti-colisão: manter mensagem inicial para cada reserva; lembrete interativo `1/2/3` vale somente para primeiro agendamento do mesmo cliente, tenant e dia. Demais lembretes ficam `SKIPPED` com `SAME_DAY_CUSTOMER_REMINDER_SUPPRESSED`.
- Migrations desta entrega: `20260821115548_whatsapp_agenda_response_statuses.sql` e `20260821145726_whatsapp_evolution_single_daily_confirmation.sql`.

### Agenda e clientes

- Detalhes do atendimento agora usam modal central. `Ligar` virou WhatsApp Web; `UNPAID` virou `Pgto Pendente`; `No-show` virou `Não compareceu`.
- Telefones da base de clientes abrem conversa WhatsApp Web em nova aba.
- Base de clientes mostra lembrete visual de aniversário entre sete dias antes e o dia do aniversário. Não há automação de mensagem de aniversário.

### Profissionais

- Lista de profissionais segue padrão visual da Base de clientes: filtro Ativos/Inativos, busca, linhas com telefone, competências, status e ações.
- Cadastro/edição abre modal central.
- `Escala e comissão` abre modal por profissional já cadastrado; escala semanal ocupa largura total, depois Exceções e, abaixo, Comissões vigentes.
- Competências, escala, exceções e comissão continuam usando fluxos/RPCs existentes.

## Pendências e limites conhecidos

- PENDENTE: validação E2E real da entrega/recebimento WhatsApp Evolution em dispositivo, incluindo callback, evento persistido, outbox e mudança final de status.
- PENDENTE: validação visual autenticada em produção das telas alteradas. Smoke público não substitui sessão de gestor/cliente.
- Não implementar WhatsApp Meta, carteira interna, sinal ou cobrança antecipada sem nova especificação e autorização.
- Não bloquear cliente em outra barbearia no mesmo dia e não impor limite rígido de duas reservas/dia. Regra vigente limita somente lembretes interativos no mesmo tenant/dia.

## Como trabalhar

1. Diante de relato funcional/visual, investigar causa em código, schema, testes e estado remoto antes de alterar.
2. Criar ou ajustar regressão quando viável; rodar validação focada e `npm.cmd run typecheck`.
3. Preserve mudanças não relacionadas no worktree.
4. Antes de release autorizado: `git diff --check`, migrations/functions remotas, commit/push, deploy e prova `READY`/alias/HTTP. Declare separadamente o que não foi validado.
