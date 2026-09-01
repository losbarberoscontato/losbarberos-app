import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("automação WhatsApp QR v2", () => {
  const migration = read("supabase/migrations/20260818023139_whatsapp_automation_v2_rebuild.sql");
  const repairMigration = read("supabase/migrations/20260818195010_repair_whatsapp_v2_webhook_completion_and_leases.sql");
  const claimRepairMigration = read("supabase/migrations/20260818212552_fix_whatsapp_v2_claim_rpc_ambiguity.sql");
  const simpleReplyMigration = read("supabase/migrations/20260818221505_simplify_whatsapp_v2_reminder_replies.sql");
  const managerNotificationMigration = read("supabase/migrations/20260819143928_whatsapp_v2_manager_notification_phone.sql");
  const managerPhoneValidationMigration = read("supabase/migrations/20260819163816_fix_whatsapp_v2_manager_notification_phone_validation.sql");
  const agendaStatusMigration = read("supabase/migrations/20260821115548_whatsapp_agenda_response_statuses.sql");
  const dailyConfirmationMigration = read("supabase/migrations/20260821145726_whatsapp_evolution_single_daily_confirmation.sql");
  const reconnectionRecoveryMigration = read("supabase/migrations/20260831201500_whatsapp_v2_reconnection_recovery.sql");
  const perAppointmentMigration = read("supabase/migrations/20260831213000_whatsapp_v2_per_appointment_t45.sql");
  const automationControlsMigration = read("supabase/migrations/20260901144842_whatsapp_v2_automation_controls_implementation.sql");
  const dispatcher = read("supabase/functions/whatsapp-v2-dispatcher/index.ts");
  const legacyOutbox = read("supabase/functions/whatsapp-send-outbox/index.ts");
  const webhook = read("supabase/functions/whatsapp-qr-webhook/index.ts");
  const config = read("supabase/functions/_shared/evolution-qr-webhook.ts");
  const identity = read("supabase/functions/_shared/evolution-message.ts");

  it("isola fila v2 da outbox QR legada", () => {
    expect(migration).toContain("create table public.whatsapp_automation_jobs");
    expect(migration).toContain("whatsapp_webhook_events_v2");
    expect(migration).toContain("LEGACY_QR_AUTOMATION_QUARANTINED");
    expect(migration).toContain("whatsapp-v2-dispatcher");
  });

  it("agenda confirmação imediata, manhã e T-45 sem envio atrasado", () => {
    expect(migration).toContain("BOOKING_CREATED_CLIENT");
    expect(migration).toContain("REMINDER_MORNING_CLIENT");
    expect(migration).toContain("REMINDER_T45_CLIENT");
    expect(migration).toContain("v_t45 <= v_morning");
    expect(migration).toContain("case when v_t45 <= now() then 'SKIPPED'");
    expect(migration).toContain("v_confirmed_transition");
  });

  it("aceita resposta numérica e altera agenda atomicamente", () => {
    expect(dispatcher).toContain("Responda somente com um número");
    expect(dispatcher).toContain("1 — Confirmar");
    expect(dispatcher).toContain("2 — Cancelar");
    expect(dispatcher).toContain("3 — Falar com atendente");
    expect(dispatcher).toContain("ATTENDANT_REQUEST_MANAGER");
    expect(dispatcher).toContain("INVALID_REPLY_PROMPT");
    expect(dispatcher).not.toContain("Responda somente com código");
    expect(dispatcher).toContain("parseResponse");
    expect(simpleReplyMigration).toContain("AMBIGUOUS_ACTIVE_REQUEST");
    expect(simpleReplyMigration).toContain("whatsapp_v2_phone_matches(c.phone_e164,p_sender_e164)");
    expect(simpleReplyMigration).toContain("invalid_reply_count");
    expect(simpleReplyMigration).toContain("ATTENDANT_REQUEST_MANAGER");
    expect(migration).toContain("whatsapp_presence_status='CONFIRMED'");
    expect(migration).toContain("perform public.cancel_appointment");
    expect(agendaStatusMigration).toContain("'CONFIRMED_BY_WHATSAPP'");
    expect(agendaStatusMigration).toContain("'CANCELED_BY_WHATSAPP'");
    expect(agendaStatusMigration).toContain("'CONTACT_REQUESTED_BY_WHATSAPP'");
  });

  it("mantém uma confirmação interativa por cliente, tenant e dia", () => {
    expect(dailyConfirmationMigration).toContain("SAME_DAY_CUSTOMER_REMINDER_SUPPRESSED");
    expect(dailyConfirmationMigration).toContain("a.customer_id=v_customer_id");
    expect(dailyConfirmationMigration).toContain("a.organization_id=v_job.organization_id");
    expect(dailyConfirmationMigration).toContain("order by lower(a.service_period), a.id");
    expect(agendaStatusMigration).toContain("set status='SUPERSEDED'");
    expect(agendaStatusMigration).not.toContain("reason','AMBIGUOUS_ACTIVE_REQUEST");
    expect(dispatcher).toContain("if (request?.skipped) return");
  });

  it("enfileira confirmação manual para cliente e profissional", () => {
    expect(agendaStatusMigration).toContain("confirm_appointment_manually_by_whatsapp");
    expect(agendaStatusMigration).toContain("MANUAL_CONFIRMATION_CLIENT");
    expect(agendaStatusMigration).toContain("MANUAL_CONFIRMATION_STAFF");
    expect(dispatcher).toContain("MANUAL_CONFIRMATION_CLIENT");
    expect(dispatcher).toContain("MANUAL_CONFIRMATION_STAFF");
    expect(dispatcher).toContain('.replaceAll("\\\\n", "\\n")');
    expect(legacyOutbox).toContain("function normalizeMessageText");
    expect(legacyOutbox).toContain('.replaceAll("\\\\n", "\\n")');
  });

  it("entrega atendimento a um número do gestor separado e sinaliza coincidência com o QR", () => {
    expect(managerNotificationMigration).toContain("manager_notification_phone_e164");
    expect(managerNotificationMigration).toContain("save_whatsapp_v2_manager_notification_phone");
    expect(managerNotificationMigration).toContain("MANAGER_NOTIFICATION_PHONE_UNAVAILABLE");
    expect(managerNotificationMigration).toContain("public.whatsapp_v2_phone_matches(c.connected_phone_e164, v_phone)");
    expect(managerNotificationMigration).toContain("'manager_notification'");
  });

  it("aceita E.164 válido no número de avisos sem escape incorreto de regex", () => {
    expect(managerPhoneValidationMigration).toContain("'^[+][1-9][0-9]{7,14}$'");
    expect(managerPhoneValidationMigration).toContain("regexp_replace(v_input, '[^0-9]', '', 'g')");
    expect(managerPhoneValidationMigration).not.toContain("^\\\\\\\\+");
  });

  it("não trata rejeição de resposta como webhook concluído", () => {
    expect(dispatcher).toContain("ProcessResult");
    expect(dispatcher).toContain("ACTION_NOT_APPLIED");
    expect(dispatcher).toContain("reason !== \"UNKNOWN_CONNECTION\"");
    expect(dispatcher).toContain("GATEWAY_INSTANCE_MISSING");
  });

  it("finaliza webhooks por uma assinatura RPC e recupera leases vencidos", () => {
    expect(dispatcher).toContain("p_terminal: terminal");
    expect(repairMigration).toContain("drop function if exists public.complete_whatsapp_v2_webhook_event(uuid, boolean, text)");
    expect(repairMigration).toContain("lock_expires_at < now()");
    expect(repairMigration).toContain("notify pgrst, 'reload schema'");
    expect(claimRepairMigration).toContain("drop function if exists public.claim_whatsapp_v2_webhook_events(integer, text)");
    expect(claimRepairMigration).toContain("drop function if exists public.claim_whatsapp_v2_webhook_events(integer, text, integer)");
    expect(dispatcher).toContain("p_lease_seconds: 90");
  });

  it("persiste webhook antes de processar e mantém QR", () => {
    expect(webhook).toContain("record_whatsapp_v2_webhook_event");
    expect(webhook).toContain("store_whatsapp_qr_code");
    expect(webhook).toContain("update_whatsapp_qr_status");
    expect(config).toContain('"MESSAGES_UPSERT"');
    expect(config).toContain('"MESSAGES_UPDATE"');
    expect(webhook).toContain("x-evolution-webhook-secret");
    expect(webhook).toContain("EdgeRuntime.waitUntil(triggerV2Dispatcher())");
  });

  it("mantém identidade LID e credencial no Vault", () => {
    expect(identity).toContain("remoteJidAlt");
    expect(identity).toContain("@lid");
    expect(migration).toContain("gateway_secret_id");
    expect(migration).toContain("vault.decrypted_secrets");
    expect(migration).toContain("get_whatsapp_v2_qr_sender_context");
  });

  it("aceita somente equivalência móvel BR após código válido", () => {
    const phoneMigration = read("supabase/migrations/20260818171344_match_whatsapp_brazilian_mobile_ninth_digit.sql");
    expect(phoneMigration).toContain("whatsapp_v2_phone_matches");
    expect(phoneMigration).toContain("substr(expected_digits,5,1) = '9'");
    expect(phoneMigration).toContain("public.whatsapp_v2_phone_matches(phone_e164,p_sender_e164)");
  });

  it("mantém T-45 independente por agendamento", () => {
    expect(perAppointmentMigration).toContain("Nenhum agendamento do mesmo dia é suprimido");
    expect(perAppointmentMigration).not.toContain("SAME_DAY_CUSTOMER_REMINDER_SUPPRESSED");
    expect(perAppointmentMigration).toContain("v_phase='T45'");
  });

  it("reinicia V2 ao reconectar QR sem replayar fluxos antigos", () => {
    expect(reconnectionRecoveryMigration).toContain("restart_whatsapp_v2_after_qr_connection");
    expect(reconnectionRecoveryMigration).toContain("'QR_CONNECTION_RESTARTED'");
    expect(reconnectionRecoveryMigration).toContain("status = 'CANCELED'");
    expect(reconnectionRecoveryMigration).toContain("status = 'EXPIRED'");
    expect(reconnectionRecoveryMigration).toContain("processing_status = 'DEAD'");
    expect(reconnectionRecoveryMigration).toContain("mode = 'ACTIVE'");
    expect(reconnectionRecoveryMigration).toContain("dispatch_paused = false");
  });

  it("impede outbox legado e respeita configuração de avisos ao barbeiro", () => {
    expect(reconnectionRecoveryMigration).toContain("Legacy outbox remains available to Meta only");
    expect(reconnectionRecoveryMigration).toContain("and c.provider = 'QR_WEB'");
    expect(reconnectionRecoveryMigration).toContain("v_settings.staff_notifications_enabled");
    expect(reconnectionRecoveryMigration).toContain("'STAFF_NOTIFICATIONS_DISABLED'");
    expect(reconnectionRecoveryMigration).toContain("c.is_active");
  });

  it("persiste template V2 no job e renderiza placeholders seguros", () => {
    expect(reconnectionRecoveryMigration).toContain("'templates',v_settings.templates");
    expect(dispatcher).toContain("configuredTemplate");
    expect(dispatcher).toContain("replaceAll(\"{cliente}\"");
    expect(dispatcher).toContain("replaceAll(\"{horario}\"");
  });

  it("controla cada automação V2 e adiciona T180 sem retroenvio", () => {
    expect(automationControlsMigration).toContain("booking_client_enabled boolean not null default true");
    expect(automationControlsMigration).toContain("booking_staff_enabled boolean not null default true");
    expect(automationControlsMigration).toContain("reminder_morning_enabled boolean not null default true");
    expect(automationControlsMigration).toContain("reminder_t180_enabled boolean not null default false");
    expect(automationControlsMigration).toContain("reminder_t45_enabled boolean not null default true");
    expect(automationControlsMigration).toContain("save_whatsapp_v2_automation_controls");
    expect(automationControlsMigration).toContain("status in ('PENDING', 'RETRY')");
    expect(automationControlsMigration).toContain("'AUTOMATION_DISABLED'");
    expect(automationControlsMigration).toContain("'REMINDER_T180_CLIENT'");
    expect(automationControlsMigration).toContain("v_start - interval '180 minutes'");
    expect(automationControlsMigration).toContain("when 'REMINDER_T180_CLIENT' then 'T180'");
    expect(dispatcher).toContain('case "REMINDER_T180_CLIENT"');
    expect(dispatcher).toContain('job.job_type === "REMINDER_T180_CLIENT"');
  });

  it("persiste personalizações sem colocá-las na fila de envio", () => {
    expect(automationControlsMigration).toContain("create table if not exists public.whatsapp_custom_message_settings_v2");
    expect(automationControlsMigration).toContain("'AFTER_SERVICE_14D'");
    expect(automationControlsMigration).toContain("'BIRTHDAY'");
    expect(automationControlsMigration).toContain("'MARKETING_CAMPAIGNS'");
    expect(automationControlsMigration).not.toContain("AFTER_SERVICE_14D', v_customer.phone_e164");
  });
});
