# Prompt para próxima conversa

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
