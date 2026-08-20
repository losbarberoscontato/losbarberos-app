# Prompt inicial — próxima conversa Los Barberos

Estamos continuando o projeto Los Barberos em `D:\Display SH\Los Barberos`.

Objetivo imediato: validar em produção o fluxo QR Web/Evolution de confirmação, lembretes de 6 horas e 45 minutos e respostas numéricas. Preserve dados existentes, tenant scope e a separação entre demo e fluxo conectado ao Supabase.

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
- Supabase ref: `bwdjkhqshmppescunwer`; migrations remotas sincronizadas até `20260817205028`.
- Edge Functions do fluxo QR ativas: `whatsapp-send-outbox` versão 13, `whatsapp-qr-webhook` versão 16, `whatsapp-qr-start` versão 12 e `whatsapp-qr-health` versão 4; confirmar novamente no preflight.
- Vercel produção: deployment direto `dpl_ES7U2dCyTSHdVDY2QfcQZNsgp9iF` `READY`, alias oficial atualizado. GitHub não foi alterado: `HEAD` e `origin/main` permaneciam em `2ca10ba` ao publicar.
- `payment_transactions` é a fonte única de verdade para pagamentos de agendamento.
- Demo nunca grava no Supabase.

## WhatsApp QR Web já entregue

- Página exclusiva conectada: `/gestor/configuracoes/whatsapp`.
- Meta Cloud API por Embedded Signup; token de tenant vai apenas para o Vault e há um provider ativo por organização.
- QR Web por Evolution API: VPS e instância em produção, início protegido por gestor, QR de conexão, callback assinado e roteamento tenant-safe.
- Confirmação inicial de agendamento já teve recebimento real validado. Lembretes de 6h/45min e respostas numéricas ainda precisam do teste E2E final.
- Respostas: `1` confirma presença e avisa o profissional; `2` pede segunda confirmação e, após confirmar, cancela e avisa o profissional; `3` registra solicitação e avisa o WhatsApp conectado do gestor com os dados do atendimento.
- O WhatsApp do profissional é cadastrado em `/gestor/equipe` e normalizado para E.164 com `+55` quando o DDI não é informado.
- Texto não numérico é encaminhado ao WhatsApp conectado do gestor para retorno manual.
- Persistência de conexões, regras de lembrete 6h/45min, ciclo de vida, opt-out e status de resposta estão modelados de forma tenant-safe.
- Instâncias Evolution existentes recebem novamente a configuração de webhook no fluxo de conexão e na checagem periódica de 15 minutos. O evento `MESSAGES_UPSERT` é obrigatório para processar respostas numéricas; falha de configuração é registrada como `WEBHOOK_CONFIGURATION_FAILED`.
- Respostas Evolution com `remoteJid=@lid` usam `remoteJidAlt` para recuperar o JID telefônico. LID, grupos e broadcasts nunca são convertidos em telefone. Respostas não associadas geram `messages.reply_rejected` sem telefone ou texto no diagnóstico.
- Meta ainda depende de verificação/análise externa. O teste do número Meta foi rejeitado pela restrição de país; não tratar Meta como validado.

## Teste E2E pendente

1. Preencher o WhatsApp do profissional usado no agendamento de teste.
2. Manter consentimento transacional ativo no cliente.
3. Criar agendamento futuro para o lembrete de 45 minutos e responder somente `1`.
4. Confirmar status `Confirmado pelo WhatsApp`, agradecimento no WhatsApp do cliente, aviso no WhatsApp do profissional e ciclo `PENDING/PROCESSING/SENT` no outbox.
5. Somente após validar `1`, testar separadamente `2` com segunda confirmação, `3`, texto não numérico e depois o lembrete de 6 horas.
6. Tratar recebimento no aparelho como única prova E2E; HTTP 200/201, função `ACTIVE` e outbox `SENT` são evidências parciais.

## Regras de operação

- Migrations são incrementais, compatíveis e só remotas com autorização explícita.
- Não publicar, aplicar migration, deployar funções, cadastrar secrets, alterar Meta, DNS ou VPS sem autorização explícita na conversa.
- Diferencie claramente: estrutura local, Edge Function publicada, Meta aprovada, QR conectado e mensagem entregue. HTTP 200 não prova fluxo autenticado.
- Preserve a regra máxima de agenda: períodos completos não podem conflitar; a constraint GiST do banco continua autoridade final.

## Primeiro passo desta próxima conversa

Faça o preflight curto e acompanhe o teste E2E em produção. Não altere VPS, Evolution, secrets ou Meta sem nova autorização explícita.
