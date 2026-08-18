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
type SenderContext = { gateway_base_url?: string; gateway_instance_id?: string; gateway_api_key?: string };

const workerId = `whatsapp-v2-${crypto.randomUUID()}`;

function formatStart(payload: Record<string, unknown>): string {
  const raw = typeof payload.starts_at === "string" ? payload.starts_at : "";
  const timezone = typeof payload.timezone === "string" ? payload.timezone : "America/Sao_Paulo";
  if (!raw) return "seu horário agendado";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: timezone }).format(new Date(raw));
}

function textFor(job: Job, shortCode?: string): string {
  const name = typeof job.payload.customer_name === "string" ? job.payload.customer_name : "cliente";
  const barber = typeof job.payload.barber_name === "string" ? job.payload.barber_name : "profissional";
  const when = formatStart(job.payload);
  switch (job.job_type) {
    case "BOOKING_CREATED_CLIENT": return `${name}, seu agendamento foi confirmado para ${when}.`;
    case "BOOKING_CREATED_STAFF": return `Novo agendamento: ${name}, ${when}.`;
    case "REMINDER_MORNING_CLIENT": return `Lembrete: seu atendimento é ${when}.\n\nResponda somente com código:\n1 ${shortCode} — Confirmar\n2 ${shortCode} — Cancelar`;
    case "REMINDER_T45_CLIENT": return `Lembrete: seu atendimento começa em 45 minutos (${when}).\n\nResponda somente com código:\n1 ${shortCode} — Confirmar\n2 ${shortCode} — Cancelar`;
    case "CONFIRMATION_ACK_CLIENT": return `Presença confirmada. Até ${when}.`;
    case "CANCELLATION_ACK_CLIENT": return "Cancelamento confirmado. Se precisar, fale com a barbearia para novo horário.";
    case "APPOINTMENT_CONFIRMED_STAFF": return `${name} confirmou presença pelo WhatsApp para ${when}.`;
    case "APPOINTMENT_CANCELED_STAFF": return `${name} cancelou pelo WhatsApp.`;
    default: return `Atualização do agendamento de ${name} com ${barber}.`;
  }
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

async function dispatchJob(job: Job): Promise<void> {
  let code: string | undefined;
  if (job.job_type === "REMINDER_MORNING_CLIENT" || job.job_type === "REMINDER_T45_CLIENT") {
    const confirmation = await rpc<{ short_code?: string }>("create_whatsapp_v2_confirmation_request", { p_job_id: job.id, p_worker_id: workerId });
    code = confirmation.short_code;
  }
  const body = textFor(job, code);
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

function parseResponse(text: string): { action: "CONFIRM" | "CANCEL"; code: string } | null {
  const match = /^\s*([12])\s+([A-Za-z0-9]{6})\s*$/u.exec(text) ?? /^\s*(CONFIRMAR|CANCELAR)\s+([A-Za-z0-9]{6})\s*$/iu.exec(text);
  if (!match) return null;
  const raw = match[1].toUpperCase();
  return { action: raw === "1" || raw === "CONFIRMAR" ? "CONFIRM" : "CANCEL", code: match[2].toUpperCase() };
}

async function dispatchEvent(event: Event): Promise<void> {
  try {
    const sender = event.payload.sender_e164;
    const text = event.payload.text;
    if (event.event_name_normalized === "MESSAGES_UPSERT" && sender && text && !event.payload.from_me) {
      await rpc("record_whatsapp_v2_inbound_message", { p_connection_id: event.connection_id, p_sender_e164: sender, p_provider_message_id: event.provider_event_id, p_body: text });
      const parsed = parseResponse(text);
      if (parsed && event.payload.gateway_instance_id) await rpc("process_whatsapp_v2_text_response", { p_gateway_instance_id: event.payload.gateway_instance_id, p_sender_e164: sender, p_external_message_id: event.provider_event_id, p_action: parsed.action, p_short_code: parsed.code });
    }
    await rpc("complete_whatsapp_v2_webhook_event", { p_event_id: event.id, p_success: true });
  } catch (error) {
    await rpc("complete_whatsapp_v2_webhook_event", { p_event_id: event.id, p_success: false, p_error: error instanceof Error ? error.message : "WEBHOOK_EVENT_FAILED" });
  }
}

Deno.serve((request) => endpoint(request, async () => {
  if (request.method !== "POST") throw new IntegrationError(405, "METHOD_NOT_ALLOWED");
  requireServiceInvocation(request);
  const payload = await request.json().catch(() => ({})) as { limit?: unknown };
  const limit = typeof payload.limit === "number" ? Math.max(1, Math.min(25, Math.floor(payload.limit))) : 25;
  const events = await rpc<Event[]>("claim_whatsapp_v2_webhook_events", { p_limit: limit, p_worker_id: workerId });
  for (const event of events) await dispatchEvent(event);
  const jobs = await rpc<Job[]>("claim_whatsapp_v2_jobs", { p_limit: limit, p_worker_id: workerId, p_lease_seconds: 120 });
  for (const job of jobs) await dispatchJob(job);
  return json(request, { processedEvents: events.length, processedJobs: jobs.length });
}));
