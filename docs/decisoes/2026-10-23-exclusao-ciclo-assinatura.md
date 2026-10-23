# Exclusão de ciclo de assinatura — 23/10/2026

## Decisão

O gestor pode excluir uma parcela de assinatura apenas quando o ciclo está aberto ou vencido e não há pagamento/baixa nem sessão agendada ou concluída. A interface usa ícone de lixeira ao lado de “Receber” e pede confirmação.

## Integridade

- A RPC `public.delete_open_subscription_cycle` valida o tenant e o papel do gestor, bloqueia assinatura e ciclo na ordem usada pelo fluxo de pagamento e é segura para repetição.
- A entrada financeira é cancelada pela rotina financeira existente; não é apagada. Ciclos com liquidação exigem ajuste/reversão própria.
- Sessões disponíveis do ciclo e o ciclo são cancelados na mesma transação; sessões agendadas/concluídas bloqueiam a operação.
- Evento `CYCLE_CANCELED` é append-only e tem chave de idempotência por ciclo.

## Publicação e verificação

- Migration `20261023175631_delete_open_subscription_cycle.sql` aplicada no Supabase `bwdjkhqshmppescunwer`; RPC `SECURITY DEFINER`, EXECUTE apenas para `authenticated` dentre os papéis públicos verificados. Advisor de segurança sem erros.
- Commit `ad8cbdbd54433579c07db9a4cabddaac7165d180` publicado em `main`; Vercel `dpl_BNz5nHkpXAiqQhtD8DHk5tS8i94M` `READY`.
- Typecheck/build/lint locais passaram; não foram executados testes locais nem validação visual autenticada.
- CI `39999912241` não passou: E2E passou; `verify` falhou em 19 testes de 10 arquivos, `database` falhou na auditoria de publicação de preço Kanban sem platform admin no reset e `edge-functions` falhou na formatação de `supabase/functions/_shared/whatsapp-templates.ts`.
