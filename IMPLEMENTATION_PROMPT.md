# Prompt inicial — próxima conversa Los Barberos

## Públicos configuráveis — 07/10/2026

Configurações permite adicionar, inativar e reativar públicos por estabelecimento. Os quatro padrões continuam disponíveis por padrão; serviços/pacotes mostram somente públicos ativos. Migration `20261007161507_organization_catalog_audiences.sql` aplicada ao Supabase. Build e typecheck aprovados; testes automatizados não executados nesta rodada. Sem mudanças em Edge Functions/WhatsApp Evolution. Detalhes e validação de produção em `HANDOFF.md`.

## Telas internas do cliente — 07/10/2026

Entrada, Home, agendamento, reservas e perfil agora consomem a identidade do produto ativo para cor e vocabulário. A Home usa a logo cadastrada pelo gestor. Perfil tem cinco seções expansíveis com controles uniformes. Nenhuma migration ou Function mudou nesta rodada; WhatsApp Evolution permanece fora do diff. Build e testes focados passaram; o `verify` geral ainda tem 7 falhas preexistentes. Confira publicação, CI e limites autenticados em `HANDOFF.md`.

## Ajuste global do acesso do cliente — 07/10/2026

O formulário compartilhado usa a logo do estabelecimento cadastrada em Configurações, com fallback para a marca publicada do produto. Textos redundantes e card informativo de WhatsApp/marketing foram removidos; rótulo do telefone agora é “Telefone/Whatsapp”. Não houve mudança no consentimento, migrations ou Edge Functions. Veja validações e limites no topo de `HANDOFF.md`.

## Entrega cliente Le Gras — 07/10/2026

Código de entrada compartilhada e skin de acesso Le Gras publicado em `main` a partir de `61cf257`. Migration `20261007131357_client_product_entry_context.sql` aplicada e alinhada no Supabase `bwdjkhqshmppescunwer`; Estúdio Gras confirmado como `le-gras`. Vercel `dpl_gsezJ417AkwwRAHHFMzetRGTQCdN` ficou `READY`, com redirecionamento público UUID → `/cliente/entrar?booking=...`. Functions não alteradas nem reimplantadas. CI inicial `37639705351` falhou em E2E sem Supabase configurado (teste ajustado), testes de UI/domínio antigos e fixture financeira pgTAP; revisar nova CI. Cadastro/login/vínculo autenticado em produção ainda não foi validado com conta controlada.

## Atualização de rotas administrativas — 28/09/2026

- Painel ecossistema oficial: `/display-admin`, protegido por `public.platform_admins`.
- `/admin` é legado e redireciona ao login de `/display-admin`.
- Login iniciado em rota de produto direciona por associação ativa de gestor ou conta de cliente, mesmo para conta que também seja administradora da plataforma.
- No acesso solicitado a `/display-admin`, administradores entram no painel; gestores existentes vão para `/gestor`, clientes para `/cliente/agendar`, novos usuários para `/onboarding`.
- O domínio temporário canônico usado pela aplicação é `https://displaysh-app.vercel.app`. A URL padrão do Supabase Auth deve acompanhar esse host; callbacks locais e de produção permanecem permitidos.
- Essa mudança não exige migration nem Edge Function.

Estamos continuando o projeto Los Barberos em `D:\Display SH\Los Barberos`.

Assuma o volante técnico para investigar e implementar os próximos relatos funcionais ou visuais. Preserve dados existentes, tenant scope e histórico financeiro. Código, migrations, testes, documentação e estado remoto verificado são fonte de verdade; não use somente o histórico do chat.

## Ambiente localhost obrigatório

Para novas implementações e correções, trabalhar primeiro em localhost:

```powershell
cd "D:\Display SH\Los Barberos"
npm.cmd run dev
```

- Use `http://localhost:3000` e o hot reload do Next.js. A primeira compilação Turbopack pode demorar.
- Use a `.env.local` existente conectada ao Supabase real. Confirme apenas os nomes das variáveis; nunca imprima valores.
- Ambiente Demo está desabilitado. Sem configuração Supabase, rotas operacionais redirecionam para `/entrar` com erro explícito; nunca usar dados locais como fallback.
- Não subir Evolution API, Docker, VPS, webhook ou serviços WhatsApp locais. Preserve toda infraestrutura Evolution/Edge Functions de produção.
- Se a porta `3000` já estiver ocupada por um `next dev` deste projeto, use esse servidor. Não inicie instância duplicada.
- Antes de `npm.cmd run verify`/build, finalize o dev server se houver conflito com `.next`; reinicie-o depois quando a validação visual continuar.
- OAuth local está autorizado pelos callbacks `http://localhost:3000/auth/callback**` e `http://127.0.0.1:3000/auth/callback**` no Supabase remoto.
- No Windows use `npm.cmd` e `npx.cmd`.

## Preflight obrigatório

1. Leia integralmente `AGENTS.md`, `HANDOFF.md`, `README.md`, este `IMPLEMENTATION_PROMPT.md`, `docs/architecture.md`, `docs/NEXT_CONVERSATION_PROMPT.md` e, conforme o escopo, `docs/google-oauth-setup.md` ou `docs/whatsapp-evolution-module.md`.
2. Confirme `git status --short`, branch, remote, SHA local, SHA de `origin/main` e divergência local/remota. Preserve mudanças não relacionadas.
3. Confirme `npx.cmd supabase migration list --linked`.
4. Se tocar WhatsApp/Edge Functions, confirme `npx.cmd supabase functions list --project-ref bwdjkhqshmppescunwer`.
5. Faça smoke em `https://losbarberos-app.vercel.app/` e `/entrar`; rota protegida `/gestor` deve redirecionar sem sessão.
6. Nunca exponha secrets, tokens, senhas, cookies, chaves ou headers de autorização.

## Sistemas conectados

- GitHub: `https://github.com/losbarberoscontato/losbarberos-app`; produção na branch `main`.
- Vercel: scope `losbarberoscontatos-projects`, projeto `losbarberos-app`, URL `https://losbarberos-app.vercel.app`.
- Supabase ref: `bwdjkhqshmppescunwer`.
- Migrations locais/remotas verificadas até `20260821145726` em 25/08/2026.
- `whatsapp-v2-dispatcher` verificado `ACTIVE`, versão 13, em 25/08/2026.
- Supabase Auth: Google ativo; `Site URL` em produção; callbacks com `**` para produção, localhost e `127.0.0.1`.

## Entregas atuais preservadas

### Entrada, Google OAuth e logout

- `/` é o hotsite. Seus botões abrem `/entrar`, uma tela focada em login/cadastro, sem repetir o hotsite e sem abas de role.
- Gestor e cliente entram/criam conta por e-mail ou Google. O callback aceita somente destinos internos conhecidos e os guards decidem membership/tenant.
- Cliente novo via Google precisa completar WhatsApp, data de nascimento e termos. Consentimento transacional começa ativo somente sem decisão anterior; opt-out não é sobrescrito.
- O callback local retorna ao localhost, não à Vercel. Configuração completa em `docs/google-oauth-setup.md`.
- Gestor possui botão funcional `Sair da conta` ao lado do perfil, também no mobile.
- Nenhuma migration ou Edge Function foi necessária para Google OAuth.

### Cliente e agendamento

- `client_accounts` é a identidade global; vínculo com barbearias continua tenant-safe e edição canônica pelo gestor permanece bloqueada.
- Home conectada, cadastro/login, agenda `COUNTER`, escolha por data, serviço, barbeiro e horário estão entregues.
- Agendamento do cliente usa fluxo em etapas/modal: serviço, profissional, horário e confirmação. Há escolha por horário sem preferência de barbeiro.
- Fluxo do cliente exige Supabase configurado; não existe fallback Demo ativo.

### Gestor, agenda e financeiro

- Agenda permite iniciar/concluir atendimento, preserva comissão e abre boleta para `COUNTER` concluído; cancelar boleta mantém `UNPAID`.
- `Contas a receber` projeta atendimentos concluídos com saldo aberto e ação `Receber`.
- `payment_transactions` é a fonte única de verdade de pagamentos de agendamento. A boleta guarda metadados sem duplicar lançamento financeiro.
- Caixa, contas, fornecedores, planos, centros, tags, lançamentos, liquidações, transferências e conta padrão `Caixa Físico` permanecem entregues.

### Projetos — serviços e comissões por pacote — 21/09/2026

- Cada pacote aceita linhas de serviço, profissional habilitado para o serviço e comissão definida para o projeto. As associações são salvas atomicamente com os dados do pacote via RPC `upsert_project_package`.
- Comissões são armazenadas em centavos, discriminadas dos outros custos extras e incorporadas na precificação sugerida e no saldo após o sinal. Contas a pagar por comissão seguem fora do escopo.
- A migration `20260921140746_project_package_service_commissions.sql` está aplicada no Supabase remoto vinculado. RLS está habilitado e forçado; a RPC exige proprietário e módulo Projetos ativos.
- Não houve alteração de Edge Functions nesta entrega; a RPC Postgres faz parte da migration.
- Também foi corrigido o feedback obsoleto ao iniciar um segundo cadastro de profissional; cadastro bem-sucedido fecha o modal.
- Publicado em `main` nos commits `a8000c3` e `e363c0e`; CI `35613874362` aprovado (Edge Functions, E2E, banco e verify), migration aplicada no Supabase remoto e deployment Vercel de produção `READY` em `https://losbarberos-app.vercel.app`.
- Próximo passo de produto: validar visualmente, com sessão autenticada, a criação/edição de pacote com pelo menos dois serviços/profissionais e conferir recálculo de custos, comissão e saldo após o sinal. O smoke HTTP público não substitui essa validação visual conectada.
- Validação automatizada local: 607 testes aprovados, 1 ignorado, lint sem erros (8 avisos existentes), typecheck e build.

### WhatsApp Evolution

- Leia `docs/whatsapp-evolution-module.md` antes de tocar no módulo.
- Estrutura QR Web, respostas `1/2/3`, confirmação manual, estados de agenda e regra de um lembrete interativo por cliente/tenant/dia estão publicadas.
- HTTP 200, provider 201, `SUBMITTED` ou Function `ACTIVE` não provam entrega no aparelho.

## Pendências conhecidas

- PENDENTE: validar manualmente em produção o primeiro cadastro completo de cliente via Google, inclusive WhatsApp/nascimento, retorno ao destino e ausência de duplicação em `client_accounts`.
- VALIDADO pelo usuário em 26/08/2026: logout conectado do gestor e proteção de `/gestor` após saída.
- VALIDADO pelo usuário em 26/08/2026: hydration mismatch da tela conectada `/gestor/configuracoes`.
- CONCLUÍDO em 26/08/2026: ambiente Demo desabilitado; testes E2E operacionais antigos que dependiam de dados locais foram removidos. Fluxos conectados exigem configuração e sessão próprias.
- VALIDADO pelo usuário em 26/08/2026: entrega WhatsApp Evolution E2E real.
- VALIDADO pelo usuário em 26/08/2026: publicação/verificação do Google Auth Platform.
- PENDENTE: adicionar no painel do gestor controles tenant-safe para ativar/desativar mensagens WhatsApp das 8h e T-45; dispatcher deve respeitar configuração persistida.
- PENDENTE externo para o final do projeto: revisão jurídica final das páginas públicas e validações Meta.
- Removidos do escopo: carteira interna e módulo WhatsApp Meta Cloud API; manter somente QR Code/Evolution.
- Backlog futuro, sem implementação agora: sinal, pagamento parcial/integral antecipado e Mercado Pago para esses pagamentos.

## Regras de execução

- Todo dado comercial exige `organization_id`; nenhuma relação cross-tenant.
- Dinheiro em centavos inteiros; percentuais em basis points.
- Agenda, pagamentos, billing e comissão devem ser atômicos e idempotentes.
- Ledgers/eventos são append-only; correções usam reversal/adjustment.
- Preserve a regra máxima: conflitos de período completo são decididos também pelo banco, não apenas pela UI.
- Investigue causa antes de corrigir e crie regressão quando viável.
- Rode validação focada, `npm.cmd run typecheck` e, antes de release, `npm.cmd run verify`.
- Peça autorização explícita nova antes de migration remota, deploy de Function, push, alteração de Auth remoto ou deploy Vercel. Uma conversa nova não herda autorização desta publicação.

## Primeiro passo

Faça o preflight, confirme que localhost conectado sobe em `http://localhost:3000` e aguarde ou investigue o próximo relato do usuário. Não altere Supabase, GitHub, Vercel, Google Cloud, Meta, Evolution/VPS ou secrets sem autorização explícita na nova conversa.
