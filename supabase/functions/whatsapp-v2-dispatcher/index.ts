import { endpoint, json } from "../_shared/http.ts";
import { IntegrationError } from "../_shared/security.ts";
import { requireServiceInvocation, rpc } from "../_shared/supabase.ts";
import { evolutionRequest, type WhatsAppSender } from "../_shared/whatsapp.ts";

type Job = {
  id: string; organization_id: string; connection_id: string; job_type: string;
  recipient_e164: string; payload: Record<string, unknown>; appointment_id: string | null;
};
type Event = {
  id: string; connection_id: string; event_name_normalized: string;
  provider_event_id: string | null; payload: { sender_e164?: string; text?: string; from_me?: boolean; gateway_instance_id?: string };
};
type ProcessResult = { processed?: boolean; reason?: string };
type SenderContext = { gateway_base_url?: string; gateway_instance_id?: string; gateway_api_key?: string };

const workerId = `whatsapp-v2-${crypto.randomUUID()}`;

function formatStart(payload: Record<string, unknown>): string {
  const raw = typeof payload.starts_at === "string" ? payload.starts_at : "";
  const timezone = typeof payload.timezone === "string" ? payload.timezone : "America/Sao_Paulo";
  if (!raw) return "seu horário agendado";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: timezone }).format(new Date(raw));
}

function configuredTemplate(job: Job): string | null {
  const templates = job.payload.templates;
  if (!templates || typeof templates !== "object" || Array.isArray(templates)) return null;
  const value = (templates as Record<string, unknown>)[job.job_type];
  return typeof value === "string" && value.trim().length > 0 && value.length <= 4_096 ? value : null;
}

function applyTemplate(template: string, job: Job, fallback: string): string {
  const name = typeof job.payload.customer_name === "string" ? job.payload.customer_name : "cliente";
  const barber = typeof job.payload.barber_name === "string" ? job.payload.barber_name : "profissional";
  const service = typeof job.payload.service_names === "string" ? job.payload.service_names : "Serviço não informado";
  const rendered = template
    // Templates persisted through JSON may contain literal "\\n" sequences.
    // Evolution must receive real line breaks for WhatsApp to format them.
    .replaceAll("\\n", "\n")
    .replaceAll("{cliente}", name)
    .replaceAll("{barbeiro}", barber)
    .replaceAll("{horario}", formatStart(job.payload))
    .replaceAll("{servico}", service);
  return rendered.trim() || fallback;
}

function textFor(job: Job): string {
  const name = typeof job.payload.customer_name === "string" ? job.payload.customer_name : "cliente";
  const barber = typeof job.payload.barber_name === "string" ? job.payload.barber_name : "profissional";
  const phone = typeof job.payload.customer_phone === "string" ? job.payload.customer_phone : "não informado";
  const service = typeof job.payload.service_names === "string" ? job.payload.service_names : "Serviço não informado";
  const messageKind = typeof job.payload.message_kind === "string" ? job.payload.message_kind : "";
  const when = formatStart(job.payload);
  let fallback: string;
  switch (job.job_type) {
    case "BOOKING_CREATED_CLIENT": fallback = `${name}, seu agendamento foi confirmado para ${when}.`; break;
    case "BOOKING_CREATED_STAFF": fallback = `Novo agendamento: ${name}, ${when}.`; break;
    case "REMINDER_MORNING_CLIENT": fallback = `Lembrete: seu atendimento é ${when}.\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente`; break;
    case "REMINDER_T180_CLIENT": fallback = `Lembrete: seu atendimento começa em 3 horas (${when}).\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente`; break;
    case "REMINDER_T45_CLIENT": fallback = `Lembrete: seu atendimento começa em 45 minutos (${when}).\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente`; break;
    case "CONFIRMATION_ACK_CLIENT": fallback = `Presença confirmada. Até ${when}.`; break;
    case "CANCELLATION_ACK_CLIENT": fallback = "Cancelamento confirmado. Se precisar, fale com a barbearia para novo horário."; break;
    case "APPOINTMENT_CONFIRMED_STAFF": fallback = `${name} confirmou presença pelo WhatsApp para ${when}.`; break;
    case "APPOINTMENT_CANCELED_STAFF": fallback = `${name} cancelou pelo WhatsApp.`; break;
    case "MANUAL_OUTBOUND_TEXT":
      if (messageKind === "INVALID_REPLY_PROMPT") fallback = "Não entendi sua resposta.\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente";
      else if (messageKind === "ATTENDANT_REQUEST_MANAGER") fallback = `Cliente deseja falar com atendente.\n\nCliente: ${name}\nWhatsApp: ${phone}\nData e hora: ${when}\nBarbeiro: ${barber}\nServiço: ${service}`;
      else if (messageKind === "MANUAL_CONFIRMATION_CLIENT") fallback = `${name}, seu agendamento foi confirmado pela barbearia para ${when}.`;
      else if (messageKind === "MANUAL_CONFIRMATION_STAFF") fallback = `Agendamento confirmado manualmente: ${name}, ${when}.`;
      else fallback = `Atualização do agendamento de ${name} com ${barber}.`;
      break;
    default: fallback = `Atualização do agendamento de ${name} com ${barber}.`;
  }
  return applyTemplate(configuredTemplate(job) ?? fallback, job, fallback);
}

async function senderFor(connectionId: string): Promise<Extract<WhatsAppSender, { provider: "QR_WEB" }>> {
  const value = await rpc<SenderContext | null>("get_whatsapp_v2_qr_sender_context", { p_connection_id: connectionId });
  if (!value?.gateway_base_url || !value.gateway_instance_id || !value.gateway_api_key) throw new IntegrationError(503, "WHATSAPP_CONNECTION_INCOMPLETE", true);
  return { provider: "QR_WEB", gatewayBaseUrl: value.gateway_base_url.replace(/\/$/u, ""), gatewayInstanceId: value.gateway_instance_id, gatewayApiKey: value.gateway_api_key };
}

function providerMessageId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { key?: { id?: unknown }; messages?: Array<{ id?: unknown }> };
  return typeof row.key?.id === "string" ? row.key.id : typeof row.messages?.[0]?.id === "string" ? row.messages[0].id : null;
}

type ConfirmationRequestResult = { skipped?: boolean };

async function dispatchJob(job: Job): Promise<void> {
  if (job.job_type === "REMINDER_MORNING_CLIENT" || job.job_type === "REMINDER_T180_CLIENT" || job.job_type === "REMINDER_T45_CLIENT") {
    const request = await rpc<ConfirmationRequestResult>("create_whatsapp_v2_confirmation_request", { p_job_id: job.id, p_worker_id: workerId });
    if (request?.skipped) return;
  }
  const body = textFor(job);
  try {
    const response = await evolutionRequest(await senderFor(job.connection_id), job.recipient_e164, { text: body });
    const id = providerMessageId(response);
    await rpc("complete_whatsapp_v2_job", { p_job_id: job.id, p_worker_id: workerId, p_success: true, p_provider_message_id: id });
    await rpc("record_whatsapp_v2_outbound_message", { p_job_id: job.id, p_provider_message_id: id, p_body: body });
  } catch (error) {
    const retryable = error instanceof IntegrationError ? error.retryable : true;
    const code = error instanceof IntegrationError ? error.code : "EVOLUTION_SEND_FAILED";
    await rpc("complete_whatsapp_v2_job", { p_job_id: job.id, p_worker_id: workerId, p_success: false, p_error_code: code, p_retryable: retryable });
  }
}

function parseResponse(text: string): { action: "CONFIRM" | "CANCEL" | "ATTENDANT" | "INVALID" } {
  const match = /^\s*([123])\s*$/u.exec(text);
  if (!match) return { action: "INVALID" };
  return { action: match[1] === "1" ? "CONFIRM" : match[1] === "2" ? "CANCEL" : "ATTENDANT" };
}

async function completeEvent(
  eventId: string,
  success: boolean,
  error: string | null = null,
  terminal = false,
): Promise<void> {
  // Always send all parameters. The database exposes one, unambiguous RPC signature.
  await rpc("complete_whatsapp_v2_webhook_event", {
    p_event_id: eventId,
    p_success: success,
    p_error: error,
    p_terminal: terminal,
  });
}

async function dispatchEvent(event: Event): Promise<void> {
  try {
    const sender = event.payload.sender_e164;
    const text = event.payload.text;
    if (event.event_name_normalized === "MESSAGES_UPSERT" && sender && text && !event.payload.from_me) {
      await rpc("record_whatsapp_v2_inbound_message", { p_connection_id: event.connection_id, p_sender_e164: sender, p_provider_message_id: event.provider_event_id, p_body: text });
        const parsed = parseResponse(text);
        if (!event.payload.gateway_instance_id) {
          await completeEvent(event.id, false, "GATEWAY_INSTANCE_MISSING", true);
          return;
        }
        const result = await rpc<ProcessResult>("process_whatsapp_v2_text_response", { p_gateway_instance_id: event.payload.gateway_instance_id, p_sender_e164: sender, p_external_message_id: event.provider_event_id, p_action: parsed.action });
        if (!result?.processed) {
          const reason = result?.reason ?? "ACTION_NOT_APPLIED";
          await completeEvent(event.id, false, reason, reason !== "UNKNOWN_CONNECTION");
          return;
        }
    }
    await completeEvent(event.id, true);
  } catch (error) {
    await completeEvent(event.id, false, error instanceof Error ? error.message : "WEBHOOK_EVENT_FAILED");
  }
}

Deno.serve((request) => endpoint(request, async () => {
  if (request.method !== "POST") throw new IntegrationError(405, "METHOD_NOT_ALLOWED");
  requireServiceInvocation(request);
  const payload = await request.json().catch(() => ({})) as { limit?: unknown };
  const limit = typeof payload.limit === "number" ? Math.max(1, Math.min(25, Math.floor(payload.limit))) : 25;
  const events = await rpc<Event[]>("claim_whatsapp_v2_webhook_events", {
    p_limit: limit,
    p_worker_id: workerId,
    p_lease_seconds: 90,
  });
  for (const event of events) await dispatchEvent(event);
  const jobs = await rpc<Job[]>("claim_whatsapp_v2_jobs", { p_limit: limit, p_worker_id: workerId, p_lease_seconds: 120 });
  for (const job of jobs) await dispatchJob(job);
  return json(request, { processedEvents: events.length, processedJobs: jobs.length });
}));
