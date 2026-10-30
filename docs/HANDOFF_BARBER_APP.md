# Prompt para próxima conversa

## Cadastro e lista de folgas — 30/10/2026

Após salvar folga/exceção, app navega para `/barbeiro/escala/folgas?barbearia=<slug>` para mostrar período recém cadastrado. Atalhos e redirect usam helper comum para manter seção antes do query param. RPC registra histórico e trigger implantado notifica gestores da organização. Sem mudança de migration ou Edge Function.

## Navegação dos atalhos de escala — 30/10/2026

Corrigido o formato dos links de adicionar folga, folgas cadastradas e histórico para `/barbeiro/escala/<seção>?barbearia=<slug>`. Sem mudança de schema ou Edge Function. Confirmar deployment e navegação autenticada conforme `HANDOFF.md`.

## Ajuste de notificações da escala — 30/10/2026

Alterações de escala feitas pelo profissional agora geram notificação no sino do gestor e evento no histórico na mesma transação. Abrange adicionar/editar/remover horário e adicionar/remover folga ou exceção. Notificações são enviadas a cada gestor `OWNER` ativo da própria organização. Migration `20261030191420_notify_managers_of_professional_schedule_changes.sql`, commit `0ad06f1` em `main`, Supabase aplicado e Vercel `READY` (`dpl_XN3Xghas3g8XUnrDPx5CHLiBAA6R`). Trigger confirmado em teste com rollback. Validação visual autenticada do sino ainda pendente; CI `41114196809` teve E2E/Edge Functions aprovados, teste geral de perfil falhou e job de banco falhou na preparação. Ver `HANDOFF.md`.

```text
Continue o projeto Los Barberos em D:\Display SH\Los Barberos. Antes de alterar qualquer coisa, leia AGENTS.md, README.md, docs/architecture.md, docs/security.md, docs/qa.md, docs/ROTEIRO_TESTES_VISUAIS_APP_BARBEIRO.md e o estado atual de Git/Supabase/Vercel. Não trate este texto como substituto do código, migrations e estado remoto.

Contexto concluído: foi criado o App do Barbeiro em /barbeiro. Ele usa a mesma conta de Cliente/Gestor, mas o acesso depende de cadastro ativo pelo Gestor na equipe, com login_email. Um mesmo e-mail pode ter vínculos ativos com múltiplas barbearias; após autenticação há escolha da organização. Sem vínculos ativos, o Barbeiro não acessa ambientes operacionais e permanece apenas com Perfil.

Entrega implementada:
- rotas /barbeiro/entrar, /barbeiro, /barbeiro/agenda, /barbeiro/caixa e /barbeiro/perfil;
- login senha/Google com retorno seguro para Barber;
- Gestor edita login_email, libera login, define escopo OWN/FULL de agenda, libera Caixa e contas permitidas;
- Agenda do Barbeiro reaproveita visual de Agenda do Gestor, com escopo OWN/FULL e operações permitidas por RPC; confirmação manual continua de Gestor;
- menu do Barbeiro reaproveita shell visual do Gestor, somente Agenda, Caixa quando permitida e Perfil; trocar barbearia fica no seletor lateral;
- Perfil permite nome, WhatsApp, foto e descrição, sem editar serviços ou comissão;
- Caixa individual existe e Gestor concilia/fecha sessões diárias no Financeiro > Visão geral > Conciliação e Financeiro > Caixa;
- migrations relevantes: 20260903154708_barber_app_and_individual_cash.sql e 20260903172810_barber_multi_organization_access.sql.

Validação automatizada desta entrega: typecheck, lint (quatro warnings pré-existentes), testes focados de Barber Auth, migrations, Agenda, shell, equipe, formatação e conciliação. A conferência visual autenticada deve seguir o roteiro e não deve ser inferida de smoke HTTP.

Próximo passo: executar roteiro visual autenticado em organização de teste, registrar resultados e corrigir apenas falhas confirmadas. Não fazer migration, deploy, push ou alteração externa sem nova autorização explícita do usuário. Preservar isolamento multi-tenant, RLS, dados financeiros append-only e valores em centavos.
```
