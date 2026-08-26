# Prompt inicial — próxima conversa Los Barberos

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
