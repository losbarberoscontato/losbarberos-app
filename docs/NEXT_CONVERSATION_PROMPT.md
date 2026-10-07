# Prompt inicial — próxima conversa Los Barberos

O acesso compartilhado do cliente recebeu a logo cadastrada do estabelecimento, textos simplificados e rótulo “Telefone/Whatsapp” em 07/10/2026. A lógica de consentimento e o módulo WhatsApp Evolution não mudaram. Veja testes e limites no topo de `HANDOFF.md`.

Entrega de 07/10/2026: entrada do cliente Le Gras e vínculo compartilhado publicados em `main`; migration `20261007131357_client_product_entry_context.sql` aplicada ao Supabase e Vercel em `READY`. Leia o registro e os limites de validação no topo de `HANDOFF.md`. Functions não tiveram mudança. A CI inicial `37639705351` falhou; acompanhar a CI do ajuste do E2E condicionado a Supabase e manter as falhas legadas de UI/domínio/pgTAP separadas. Teste autenticado com conta controlada e conferência do cliente no gestor permanecem pendentes.

Use como prompt canônico o conteúdo de `IMPLEMENTATION_PROMPT.md` na raiz do repositório. Ele contém o baseline atualizado em 21/09/2026, incluindo as comissões por serviço nos pacotes de projetos, as entregas de Google OAuth/entrada/logout, as pendências conhecidas e as regras para rodar localhost conectado com hot reload.

Antes de começar, leia integralmente `AGENTS.md`, `HANDOFF.md`, `README.md`, `IMPLEMENTATION_PROMPT.md` e `docs/architecture.md`; confirme Git, Supabase e o smoke de produção. Uma nova conversa precisa de autorização explícita nova antes de qualquer migration remota, deploy de Function, push ou deploy Vercel.
