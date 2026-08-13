# Prompt inicial — próxima conversa Los Barberos

Estamos continuando o projeto Los Barberos em `D:\Display SH\Los Barberos`.

Objetivo imediato: configurar o piloto de WhatsApp QR Web na VPS Hostinger KVM2 e, em seguida, concluir as automações pendentes de WhatsApp. Preserve dados existentes, tenant scope e a separação entre demo e fluxo conectado ao Supabase.

## Preflight obrigatório

1. Leia integralmente `AGENTS.md`, `HANDOFF.md`, `README.md`, este `IMPLEMENTATION_PROMPT.md` e `docs/architecture.md`.
2. Confirme `git status --short`, branch, remote, SHA de `origin/main` e commits locais/remotos.
3. Confirme `npx.cmd supabase migration list --linked`.
4. Faça smoke em `https://losbarberos-app.vercel.app/entrar`.
5. Use código, migrations, testes e estado remoto verificado como fonte de verdade.
6. Nunca exponha secrets, tokens, cookies ou headers de autorização.

## Baseline atual

- GitHub: `https://github.com/losbarberoscontato/losbarberos-app`; confirmar branch/SHA no preflight.
- Vercel: `https://losbarberos-app.vercel.app`.
- Supabase ref: `bwdjkhqshmppescunwer`; migrations remotas sincronizadas até `202608110007`.
- Edge Functions WhatsApp ativas: `whatsapp-webhook`, `whatsapp-send-outbox`, `whatsapp-embedded-signup-start`, `whatsapp-embedded-signup-callback`, `whatsapp-qr-start` e `whatsapp-qr-webhook`.
- `payment_transactions` é a fonte única de verdade para pagamentos de agendamento.
- Demo nunca grava no Supabase.

## WhatsApp híbrido já entregue

- Página exclusiva conectada: `/gestor/configuracoes/whatsapp`.
- Meta Cloud API por Embedded Signup; token de tenant vai apenas para o Vault e há um provider ativo por organização.
- QR Web por Evolution API: início protegido por gestor, QR de conexão, callback assinado e roteamento tenant-safe. Ainda não existe VPS/instância Evolution configurada.
- Persistência de conexões, regras de lembrete 6h/45min, configurações de confirmação/boas-vindas, ciclo de vida de conexão, opt-out e registro de status estão modelados de forma tenant-safe.
- Meta ainda depende de verificação/análise externa. O teste do número Meta foi rejeitado pela restrição de país; não tratar Meta como validado.

## Primeiro bloco: VPS Hostinger KVM2

Assuma uma VPS KVM2 ou equivalente, dedicada inicialmente ao Los Barberos, com Ubuntu 24.04 e Docker Compose. Antes de mudar código ou segredos:

1. Peça ao usuário somente os dados externos necessários depois que ele contratar/acessar a VPS: IP ou hostname público, método de acesso SSH, subdomínio escolhido para Evolution e domínio já apontado.
2. Crie um plano de infraestrutura mínimo e seguro: usuário sem root para operação, atualizações, firewall restritivo, SSH por chave, Docker Engine/Compose, proxy reverso HTTPS, renovação de certificado, volumes persistentes, restart policy, logs e backup.
3. Consulte a documentação atual da versão escolhida da Evolution API antes de escrever `docker-compose`; não invente variáveis de ambiente, banco ou fila necessários.
4. Mantenha Evolution e dependências em rede Docker privada; somente o proxy reverso fica exposto. Nunca coloque API key, webhook secret ou token no browser, Git, logs ou chat.
5. Depois de HTTPS e persistência validados, configure os secrets `EVOLUTION_API_BASE_URL`, `EVOLUTION_API_KEY` e `EVOLUTION_WEBHOOK_SECRET` no ambiente seguro das Edge Functions, configure o webhook QR e faça um piloto controlado com o WhatsApp Business de teste.
6. `losbarberos.com.br` ainda será migrado no futuro. Use variáveis/configuração para URLs; não quebre a origem Vercel atual nem publique DNS sem autorização explícita.

## Etapas pendentes após VPS

1. Validar QR Web real: gerar QR na página do gestor, escanear com WhatsApp Business de teste, receber `CONNECTED` por webhook, enviar uma mensagem transacional e validar reconexão/desconexão. Não chamar esse canal de oficial.
2. Completar automações: substituir o agendamento legado `appointment_reminder_0700` por confirmação, lembretes configuráveis de 6h e 45min e regras tenant-safe de outbox.
3. Completar mensagem de boas-vindas para primeira mensagem recebida, com variáveis permitidas e sem marketing implícito.
4. Validar opt-out `SAIR`, bloquear novos envios e registrar consentimento/evento de forma auditável.
5. Validar enviados, entregues, lidos e falhos, incluindo idempotência, lease, retry seguro e isolamento por `organization_id`.
6. Criar testes de integração/UI para cada regressão relevante e rodar `npm.cmd run verify` antes de qualquer publicação.

## Regras de operação

- Migrations são incrementais, compatíveis e só remotas com autorização explícita.
- Não publicar, aplicar migration, deployar funções, cadastrar secrets, alterar Meta, DNS ou VPS sem autorização explícita na conversa.
- Diferencie claramente: estrutura local, Edge Function publicada, Meta aprovada, QR conectado e mensagem entregue. HTTP 200 não prova fluxo autenticado.
- Preserve a regra máxima de agenda: períodos completos não podem conflitar; a constraint GiST do banco continua autoridade final.

## Primeiro passo desta próxima conversa

Faça o preflight curto e informe estado real de GitHub, Supabase e Vercel. Depois peça somente o acesso/dados mínimos da VPS Hostinger KVM2 para montar o plano de Docker/HTTPS do Evolution API.
