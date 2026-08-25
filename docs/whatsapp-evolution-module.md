# Módulo WhatsApp Evolution

> Fonte técnica para manutenção do canal WhatsApp via Evolution API. Leia este documento antes de alterar agenda, lembretes, QR, webhooks, jobs ou notificações do WhatsApp.

## Escopo e fronteiras

Este módulo conecta uma conta WhatsApp Business por QR Code à **Evolution API** hospedada em VPS. É o canal `QR_WEB`, não oficial, usado para mensagens transacionais da agenda.

O módulo **WhatsApp Meta** é separado: usa `META_CLOUD`/API oficial da Meta, Embedded Signup e outros callbacks. Não faz parte deste documento nem deve compartilhar filas, credenciais, regras de resposta ou suposições de entrega com Evolution.

Supabase/PostgreSQL é fonte de verdade. Evolution é somente transporte. Um retorno HTTP da Evolution, um job `SUBMITTED` ou webhook HTTP `200` não prova entrega no aparelho.

## Objetivos

- Conectar/desconectar QR de modo tenant-safe.
- Criar mensagens de agendamento, lembretes e respostas operacionais.
- Receber mensagens de clientes, persistir o evento antes de processá-lo e aplicar respostas idempotentes.
- Notificar cliente, profissional e gestor conforme fluxo.
- Manter agenda, pagamento e ocupação do horário no banco; nunca no payload do WhatsApp.

## Arquitetura

```text
Gestor / tela de configurações
  -> whatsapp-qr-start
  -> Evolution API na VPS
  -> QR + CONNECTION_UPDATE
  -> whatsapp-qr-webhook
  -> whatsapp_webhook_events_v2
  -> whatsapp-v2-dispatcher
  -> RPCs Supabase / whatsapp_automation_jobs
  -> Evolution API / WhatsApp

Agenda confirmada
  -> trigger PostgreSQL
  -> whatsapp_automation_jobs
  -> cron a cada minuto + dispatcher
  -> Evolution API
```

## Componentes e responsabilidades

| Área | Arquivo/objeto | Responsabilidade |
| --- | --- | --- |
| Tela gestor | `src/components/connected-manager/whatsapp-settings.tsx` | Configuração, QR, conexão, saúde e número de aviso do gestor. |
| Início QR | `supabase/functions/whatsapp-qr-start/index.ts` | Autentica owner, cria/reutiliza instância estável `lb-<8 primeiros caracteres do organization_id>`, reaplica webhook e retorna QR. |
| Webhook Evolution | `supabase/functions/whatsapp-qr-webhook/index.ts` | Valida assinatura, trata QR/status, persiste eventos de mensagem e dispara dispatcher. |
| Saúde QR | `supabase/functions/whatsapp-qr-health/index.ts` | Executado por serviço; reaplica webhook e registra estado/erros da instância. |
| Dispatcher V2 | `supabase/functions/whatsapp-v2-dispatcher/index.ts` | Consome eventos e jobs, cria solicitações de confirmação, interpreta `1`/`2`/`3` e envia texto pela Evolution. |
| Transporte | `supabase/functions/_shared/whatsapp.ts` | Resolve sender QR e chama Evolution para envio de texto. |
| Identidade inbound | `supabase/functions/_shared/evolution-message.ts` | Extrai telefone do JID; usa `remoteJidAlt` para LID e rejeita grupos/broadcasts. |
| Configuração webhook | `supabase/functions/_shared/evolution-qr-webhook.ts` | Define URL assinada e eventos obrigatórios da Evolution. |
| Dados e invariantes | migrations `20260818023139_*` e posteriores | Fila V2, persistência, RLS, RPCs, dedupe, retry, consentimento e estados. |

## APIs e infraestrutura ligadas

### Evolution API na VPS

- `POST /instance/create`: cria instância QR usando Baileys.
- `GET /instance/connect/{instance}`: recupera QR para conexão.
- `POST /webhook/set/{instance}`: configura/reconfigura callback; deve ser reaplicado em reconexões e health-check.
- `GET /instance/connectionState/{instance}`: consulta saúde.
- `GET /instance/fetchInstances`: recupera número conectado quando necessário.
- Endpoint de envio de texto usado pelo adapter `evolutionRequest`.

Eventos obrigatórios: `QRCODE_UPDATED`, `CONNECTION_UPDATE`, `MESSAGES_UPSERT` e `MESSAGES_UPDATE`.

### Supabase

- PostgreSQL: dados, RLS, gatilhos, RPCs e cron.
- Vault: URLs/chaves da Evolution e credenciais internas; o navegador nunca recebe essas chaves.
- Edge Functions: início QR, webhook, health-check e dispatcher.
- `pg_cron` + `pg_net`: chama `whatsapp-v2-dispatcher` a cada minuto por `app_private.dispatch_edge_function`.

### Secrets server-side

Nomes esperados: `EVOLUTION_API_BASE_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_WEBHOOK_SECRET`, `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`. Nunca registrar valores, incluí-los em `NEXT_PUBLIC_*`, commits, logs ou documentação.

## Modelo de dados V2

Todas as tabelas de negócio usam `organization_id`. Relações compostas e RLS impedem cruzamento entre barbearias.

| Tabela/objeto | Papel |
| --- | --- |
| `whatsapp_business_connections` | Conexão `QR_WEB`, instância, estado, telefone conectado e referência secreta. |
| `whatsapp_automation_settings_v2` | Modo `OFF`/`SHADOW`/`ACTIVE`, lembretes, pausa e telefone separado do gestor. |
| `whatsapp_contact_preferences_v2` | Preferência transacional por cliente. |
| `whatsapp_automation_jobs` | Fila persistente de saída; lease, retry, dedupe, tentativa e estado. |
| `whatsapp_confirmation_requests_v2` | Uma solicitação de resposta pendente por fluxo; fase, expiração e contagem de respostas inválidas. |
| `whatsapp_webhook_events_v2` | Evento inbound persistido antes do processamento; fingerprint torna webhook idempotente. |
| `whatsapp_contacts_v2`, `whatsapp_conversations_v2`, `whatsapp_messages_v2` | Histórico operacional de mensagens e conversas. |
| `appointment_status_events` | Auditoria append-only das mudanças relacionadas ao atendimento. |

Não misturar a fila V2 com `notification_outbox`/fluxo QR legado. A versão V1 está arquivada em `docs/archive/whatsapp-evolution-v1/`.

## Fluxos funcionais

### Conexão QR

1. Owner inicia QR na tela do gestor.
2. `whatsapp-qr-start` valida usuário e organização, cria ou reutiliza instância estável.
3. Webhook é configurado mesmo para instância já existente.
4. QR é armazenado com expiração curta e exibido ao gestor.
5. `CONNECTION_UPDATE` altera estado e persiste telefone conectado.
6. Health-check periódico consulta a Evolution e reaplica o webhook.

Uma falha `WEBHOOK_CONFIGURATION_FAILED` significa que respostas recebidas podem não chegar ao sistema.

### Agendamento e lembretes

Quando um agendamento entra no estado operacional `CONFIRMED`, o banco cria jobs V2 tenant-safe, conforme configuração ativa:

- confirmação inicial para cliente e profissional;
- lembrete de manhã/8h (`REMINDER_MORNING_CLIENT`);
- lembrete T-45 (`REMINDER_T45_CLIENT`);
- confirmação, cancelamento e avisos operacionais subsequentes.

O dispatcher cria `whatsapp_confirmation_requests_v2` ao enviar lembrete. T-45 substitui a solicitação pendente anterior da mesma versão do agendamento.

Para que `1`, `2` e `3` tenham um único atendimento-alvo, existe no máximo um fluxo interativo por **cliente + organização + dia local**: o atendimento confirmado mais cedo. Outros atendimentos do mesmo cliente e dia continuam válidos na agenda, mas seus jobs de lembrete ficam `SKIPPED` com `SAME_DAY_CUSTOMER_REMINDER_SUPPRESSED`; eles não recebem mensagem interativa. A regra é por tenant e nunca bloqueia reservas em outras barbearias.

### Respostas do cliente

`MESSAGES_UPSERT` é persistido primeiro. O dispatcher ignora mensagens enviadas pela própria conta, grupos e broadcasts; depois interpreta apenas texto `1`, `2` ou `3`.

| Entrada | Efeito esperado |
| --- | --- |
| `1` | Confirma presença, altera status de resposta da agenda para confirmado, registra evento, envia confirmação ao cliente e avisa profissional. |
| `2` | Cancela por RPC transacional, libera horário, registra origem WhatsApp e avisa cliente/profissional. |
| `3` | Marca solicitação de contato e enfileira aviso para número de gestor configurado. |
| Texto inválido | Até duas vezes, pede nova resposta. Na terceira, trata como solicitação de contato. |

Respostas só valem para solicitação pendente, ainda não expirada, cliente/telefone correspondente, conexão ativa, versão atual do atendimento e status operacional `CONFIRMED`.

### Confirmação manual pela agenda

O botão da agenda usa a RPC `confirm_appointment_manually_by_whatsapp` quando disponível no banco. Ela deve:

- exigir owner da organização, conexão QR ativa, consentimento transacional e WhatsApp de cliente/profissional;
- expirar solicitações e cancelar lembretes pendentes daquele atendimento;
- gravar evento auditável;
- marcar resposta `CONFIRMED_MANUALLY`;
- enfileirar texto para cliente e profissional.

**Estado de publicação verificado em 25/08/2026:** as migrations estão sincronizadas até `20260821145726` e o `whatsapp-v2-dispatcher` está `ACTIVE` na versão 13. Isso prova estrutura publicada, não entrega real no aparelho; a validação E2E de recebimento continua pendente.

## Estados e regras de agenda

`appointments.status` é estado operacional: ocupação, pagamento e execução do atendimento. Não o use para deduzir a origem da resposta do WhatsApp.

`appointments.whatsapp_response_status` é projeção de comunicação exibida na agenda e no portal do cliente:

| Resposta | Exibição | Cor |
| --- | --- | --- |
| `PENDING` | Agendado | Azul |
| `CONFIRMED_BY_WHATSAPP` | Confirmado | Verde |
| `CANCELED_BY_WHATSAPP` + operacional `CANCELED` | Cancelado - horário liberado | Vermelho |
| `CONTACT_REQUESTED_BY_WHATSAPP` | Solicitado Contato | Roxo |
| `CONFIRMED_MANUALLY` | Confirmado Manualmente | Verde claro/verde |

O portal do cliente apresenta somente `Agendado`, `Confirmado`, `Cancelado` e `Confirmado Manualmente`, conforme regra de produto.

## Segurança e invariantes

- Proprietário autenticado inicia ou administra conexão; funções internas exigem service role.
- Webhook valida `x-evolution-webhook-secret` antes de processar payload.
- Segredos residem no Vault/Edge Functions; logs expõem somente códigos seguros de erro.
- JID `@lid` não é telefone. Preferir JID alternativo; nunca converter LID, grupos ou broadcast em E.164.
- E.164 é normalizado e validado. Número do gestor é distinto do número conectado por QR.
- `organization_id`, RLS, FK composta e idempotency/dedupe key são obrigatórios em toda escrita.
- Jobs usam lease, `FOR UPDATE SKIP LOCKED`, retry e dead letter; correções preservam histórico.
- Cancelamento usa RPC transacional; não atualizar ocupação/financeiro diretamente no webhook.
- Opt-out transacional cancela jobs de cliente ainda pendentes; não contornar consentimento.

## Operação, diagnóstico e evidências

Ordem de investigação para qualquer problema de WhatsApp Evolution:

1. Confirmar conexão `QR_WEB`, `ACTIVE`, não pausada, telefone do gestor e telefone do profissional quando necessário.
2. Confirmar `MESSAGES_UPSERT` na Evolution e evento em `whatsapp_webhook_events_v2`.
3. Examinar `processing_status`, `last_error`, `attempt_count` e fingerprint do evento.
4. Examinar `whatsapp_confirmation_requests_v2`: pendência, expiração, fase e versão do atendimento.
5. Examinar jobs/mensagens: `PENDING` → `PROCESSING` → `SUBMITTED`/`DELIVERED` ou `RETRY`/`DEAD_LETTER`.
6. Confirmar atualização do agendamento e `appointment_status_events`.
7. Confirmar chamada da Evolution e, por último, recebimento no aparelho.

Erros conhecidos:

- `MANAGER_NOTIFICATION_PHONE_UNAVAILABLE`: telefone de aviso do gestor não foi persistido; não houve job de saída para gestor.
- `WEBHOOK_CONFIGURATION_FAILED`: callback não foi configurado/reconfigurado na Evolution.
- `SENDER_PHONE_UNRESOLVED`: JID não permitiu resolver telefone seguro.
- `NO_ACTIVE_REQUEST`: não há solicitação válida para o remetente.
- `SAME_DAY_CUSTOMER_REMINDER_SUPPRESSED`: outro atendimento confirmado, mais cedo, já é o dono da confirmação daquele cliente no mesmo dia local.

Como recuperação para requests duplicadas já existentes, a primeira resposta numérica escolhe deterministicamente o atendimento mais próximo e marca os outros requests pendentes como `SUPERSEDED`. Isso evita travamento, mas não reconstrói a intenção de mensagens antigas; a prevenção é a regra diária acima.

## Manutenção e publicação

- Não iniciar Evolution localmente para testar este projeto. Rode apenas Next.js com `.env.local` conectada quando validação visual local for necessária.
- Não alterar VPS, Evolution, webhook, Vault, migrations ou Edge Functions sem autorização explícita.
- Para mudança de schema, criar migration incremental, testar, aplicar ao Supabase e verificar alinhamento remoto antes do deploy de UI dependente.
- Se alterar lógica do dispatcher, publicar `whatsapp-v2-dispatcher` junto da migration compatível. Se alterar recebimento/assinatura, publicar também `whatsapp-qr-webhook`.
- Verificar cada camada separadamente: webhook HTTP, evento persistido, job, chamada Evolution, estado de mensagem e recibo real.
- Testes de referência: `tests/integrations/whatsapp-qr-automation.test.ts`, `tests/domain/appointment-display-status.test.ts` e `tests/ui/manager-connected.test.tsx`.

## Fora de escopo deste módulo

- API oficial/Cloud API da Meta e seus templates, WABA e Embedded Signup.
- Campanhas, aniversários e promoções.
- Alteração de VPS, DNS, proxy, Docker ou configuração da Evolution sem tarefa específica autorizada.
