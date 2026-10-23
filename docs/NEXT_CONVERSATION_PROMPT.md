# Projetos e Planos Encerrados — 23/10/2026

Commit `4ae4e740841a0fa32d59c2b03f4d8e869554bd04` em `main`; migration `20261023172902_archive_closed_customer_plans_and_delete_project_installment.sql` aplicada; Vercel `dpl_GeHMJDnxztuwLX5LqSixSS6jHEZ4` `READY`. CI `39996560127`: `database`, `verify` e `edge-functions` falharam; E2E ainda em andamento. Não declarar CI verde. Fazer validação visual autenticada de cancelamentos e arquivo de planos e consultar logs finais do CI. Consulte `HANDOFF.md`.

# Prompt inicial — próxima conversa Los Barberos

Entrega de 21/10/2026: Google Calendar em `main` (`d2cc9bb`), migration e três Functions ativas no Supabase; Vercel `READY` (`dpl_22yL3N3K8aZyf9hbKRYRPt6fns9U`). OAuth autenticado e sincronização real ainda `NÃO VALIDADOS`. Google Auth Platform em `Testing`: autorização limitada a test users e tokens expiram em 7 dias; publicar/verificar escopo sensível para uso geral. Consulte o topo de `HANDOFF.md`; CI atual tem falhas preexistentes documentadas.

Entrega de 20/10/2026: Kanban de Atendimentos e guardas do agendamento livre publicados em `main` (`c1f5e03`), Supabase alinhado e Function `stripe-kanban-module` ativa. Vercel `READY` (`dpl_BNFpXL1AuH84VqrG3zUxvYSTBYhA`). Módulo ainda inativo, sem preço publicado. CI `39486634305` vermelha por testes gerais, formatação antiga de WhatsApp e fixture pgTAP; E2E passou. Veja estado preciso em `HANDOFF.md` e teste visual em `docs/CHECKLIST_VISUAL_KANBAN_ATENDIMENTOS.md`.

Entrega de 07/10/2026: públicos configuráveis por estabelecimento publicados em `main`; migration `20261007161507_organization_catalog_audiences.sql` aplicada ao Supabase `bwdjkhqshmppescunwer`. Deploy da Vercel e CI devem ser confirmados nesta entrega; testes automatizados não foram executados localmente. Edge Functions e WhatsApp Evolution não foram alterados. Consulte o topo de `HANDOFF.md`.

As telas internas do cliente agora usam identidade por produto e vocabulário contextual; entrada e perfil receberam as simplificações solicitadas. A Home usa a logo do estabelecimento. Nenhuma migration ou Function foi alterada nesta rodada. Consulte `HANDOFF.md` para testes, publicação e limites de prova autenticada.

O acesso compartilhado do cliente recebeu a logo cadastrada do estabelecimento, textos simplificados e rótulo “Telefone/Whatsapp” em 07/10/2026. A lógica de consentimento e o módulo WhatsApp Evolution não mudaram. Veja testes e limites no topo de `HANDOFF.md`.

Entrega de 07/10/2026: entrada do cliente Le Gras e vínculo compartilhado publicados em `main`; migration `20261007131357_client_product_entry_context.sql` aplicada ao Supabase e Vercel em `READY`. Leia o registro e os limites de validação no topo de `HANDOFF.md`. Functions não tiveram mudança. A CI inicial `37639705351` falhou; acompanhar a CI do ajuste do E2E condicionado a Supabase e manter as falhas legadas de UI/domínio/pgTAP separadas. Teste autenticado com conta controlada e conferência do cliente no gestor permanecem pendentes.

Use como prompt canônico o conteúdo de `IMPLEMENTATION_PROMPT.md` na raiz do repositório. Ele contém o baseline atualizado em 21/09/2026, incluindo as comissões por serviço nos pacotes de projetos, as entregas de Google OAuth/entrada/logout, as pendências conhecidas e as regras para rodar localhost conectado com hot reload.

Antes de começar, leia integralmente `AGENTS.md`, `HANDOFF.md`, `README.md`, `IMPLEMENTATION_PROMPT.md` e `docs/architecture.md`; confirme Git, Supabase e o smoke de produção. Uma nova conversa precisa de autorização explícita nova antes de qualquer migration remota, deploy de Function, push ou deploy Vercel.
