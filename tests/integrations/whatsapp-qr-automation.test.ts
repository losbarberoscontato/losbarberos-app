import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("automação WhatsApp QR Web", () => {
  const migration = read("supabase/migrations/20260816124514_whatsapp_qr_automation.sql");
  const reminderFix = read("supabase/migrations/20260817121049_whatsapp_reminders_and_response_status.sql");
  const textFallback = read("supabase/migrations/20260817145712_whatsapp_reminder_text_fallback.sql");
  const textOnlyDelivery = read("supabase/migrations/20260817180209_whatsapp_reminder_text_only_delivery.sql");
  const operationalNotifications = read("supabase/migrations/20260817184337_barber_whatsapp_operational_notifications.sql");
  const sender = read("supabase/functions/whatsapp-send-outbox/index.ts");
  const shared = read("supabase/functions/_shared/whatsapp.ts");
  const qrStart = read("supabase/functions/whatsapp-qr-start/index.ts");
  const qrWebhook = read("supabase/functions/whatsapp-qr-webhook/index.ts");
  const teamManager = read("src/components/connected-manager/team-manager.tsx");
  const booking = read("src/components/connected-client/booking.tsx");
  const profile = read("src/components/connected-client/profile.tsx");

  it("substitui templates legados por confirmação e regras configuráveis", () => {
    expect(migration).toContain("appointment_confirmation");
    expect(migration).toContain("appointment_reminder_6h");
    expect(migration).toContain("appointment_reminder_45m");
    expect(migration).toContain("r.enabled");
    expect(migration).toContain(":reminder:");
    expect(migration).toContain("CONFIRM_ATTENDANCE");
    expect(migration).toContain("recipient_kind', 'OPERATIONAL'");
    expect(migration).toContain("whatsapp-reschedule-operational:");
  });

  it("preserva consentimento e idempotência no worker", () => {
    expect(migration).toContain("latest_consent.action = 'GRANTED'");
    expect(migration).toContain("on conflict (organization_id, idempotency_key) do nothing");
    expect(profile).toContain("recordWhatsappConsent");
    expect(booking).toContain("A reserva continua disponível");
  });

  it("mantém leitura legada de botões, mas envia lembretes Evolution por texto", () => {
    const evolutionBuilder = sender.slice(
      sender.indexOf("function buildEvolutionMessage"),
      sender.indexOf("Deno.serve"),
    );
    expect(qrStart).toContain('"MESSAGES_UPSERT"');
    expect(qrWebhook).toContain("buttonsResponseMessage");
    expect(qrWebhook).toContain("process_whatsapp_action_token");
    expect(sender).toContain("EVOLUTION_REMINDER_BUTTONS");
    expect(shared).toContain("sendButtons");
    expect(evolutionBuilder).not.toContain('type: "reply"');
    expect(evolutionBuilder).not.toContain("displayText");
    expect(sender).toContain("result.key?.id");
    expect(shared).toContain("sendText");
  });

  it("qualifica pgcrypto e não envia lembretes anteriores à conexão QR", () => {
    expect(reminderFix).toContain("extensions.gen_random_bytes(32)");
    expect(reminderFix).toContain("extensions.digest(v_confirm_token, 'sha256')");
    expect(reminderFix).toContain("v_reminder_at < q.connection_epoch_at");
    expect(reminderFix).toContain("set search_path = public, extensions, pg_temp");
  });

  it("persiste a resposta WhatsApp sem substituir o estado operacional", () => {
    expect(reminderFix).toContain("appointment_whatsapp_response_status");
    expect(reminderFix).toContain("CONFIRMED_BY_WHATSAPP");
    expect(reminderFix).toContain("CANCELED_BY_WHATSAPP");
    expect(reminderFix).toContain("RESCHEDULE_REQUESTED_BY_WHATSAPP");
    expect(reminderFix).toContain("public.record_appointment_whatsapp_response");
    expect(reminderFix).toContain("perform public.cancel_appointment");
  });

  it("não gera lembrete atrasado e aceita fallback textual 1, 2 ou 3", () => {
    expect(textFallback).toContain("v_row.created_at <= v_reminder_at");
    expect(textFallback).toContain("process_whatsapp_text_action");
    expect(textFallback).toContain("CONFIRM_ATTENDANCE");
    expect(textFallback).toContain("REQUEST_CANCEL");
    expect(textFallback).toContain("RESCHEDULE");
    expect(textFallback).toContain("'MANTER'");
    expect(sender).toContain("Digite 1 para confirmar, 2 para cancelar ou 3 para reagendar.");
    expect(qrWebhook).toContain("process_whatsapp_text_action");
  });

  it("envia lembretes QR diretamente como texto e mantém todo cancelamento numérico", () => {
    expect(textOnlyDelivery).toContain("'message_kind', 'TEXT'");
    expect(textOnlyDelivery).not.toContain("'message_kind', 'EVOLUTION_REMINDER_BUTTONS'");
    expect(textOnlyDelivery).toContain("Responda apenas com um número:");
    expect(textOnlyDelivery).toContain("1 - Confirmar");
    expect(textOnlyDelivery).toContain("2 - Cancelar");
    expect(textOnlyDelivery).toContain("3 - Reagendar");
    expect(textOnlyDelivery).toContain("new.status := 'CANCELED'");
    expect(textOnlyDelivery).toContain("WHATSAPP_DISCONNECTED_AT_REMINDER_TIME");
    expect(textOnlyDelivery).toContain("REMINDER_PREDATES_CONNECTION_EPOCH");
    expect(textOnlyDelivery).toContain("t.action::text = 'CONFIRM_CANCEL'");
    expect(sender).toContain("Digite 1 para confirmar, 2 para cancelar ou 3 para reagendar.");
    expect(sender).toContain("Digite 1 para confirmar o cancelamento ou 2 para manter o horário.");
    expect(sender).not.toContain("evolution_buttons_fallback_to_text");
  });

  it("avisa o barbeiro e o gestor conectado conforme a resposta numérica", () => {
    expect(operationalNotifications).toContain("add column if not exists whatsapp_e164");
    expect(operationalNotifications).toContain("+55");
    expect(operationalNotifications).toContain("connected_phone_e164");
    expect(operationalNotifications).toContain("store_whatsapp_qr_connected_phone");
    expect(operationalNotifications).toContain("forward_unrecognized_whatsapp_message");
    expect(operationalNotifications).toContain("whatsapp-manual-follow-up:");
    expect(operationalNotifications).toContain("= 'BARBER'");
    expect(operationalNotifications).toContain("'recipient_kind', 'CONNECTED_MANAGER'");
    expect(operationalNotifications).toContain("CONFIRM_ATTENDANCE");
    expect(operationalNotifications).toContain("CONFIRM_CANCEL");
    expect(operationalNotifications).toContain("RESCHEDULE");
    expect(operationalNotifications).toContain("v_customer_phone");
    expect(operationalNotifications).toContain("v_barber_name");
    expect(operationalNotifications).toContain("v_service_names");
    expect(qrWebhook).toContain("/instance/fetchInstances");
    expect(qrWebhook).toContain("ownerJid");
    expect(qrWebhook).toContain("store_whatsapp_qr_connected_phone");
    expect(qrWebhook).toContain("forward_unrecognized_whatsapp_message");
    expect(teamManager).toContain("normalizePhoneE164");
    expect(teamManager).toContain('name="whatsapp_e164"');
  });
});
