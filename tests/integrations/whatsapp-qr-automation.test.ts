import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("automação WhatsApp QR v2", () => {
  const migration = read("supabase/migrations/20260818023139_whatsapp_automation_v2_rebuild.sql");
  const dispatcher = read("supabase/functions/whatsapp-v2-dispatcher/index.ts");
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

  it("exige código por resposta e altera agenda atomicamente", () => {
    expect(dispatcher).toContain("1 ${shortCode} — Confirmar");
    expect(dispatcher).toContain("2 ${shortCode} — Cancelar");
    expect(dispatcher).toContain("parseResponse");
    expect(migration).toContain("short_code_hash");
    expect(migration).toContain("whatsapp_presence_status='CONFIRMED'");
    expect(migration).toContain("perform public.cancel_appointment");
  });

  it("persiste webhook antes de processar e mantém QR", () => {
    expect(webhook).toContain("record_whatsapp_v2_webhook_event");
    expect(webhook).toContain("store_whatsapp_qr_code");
    expect(webhook).toContain("update_whatsapp_qr_status");
    expect(config).toContain('"MESSAGES_UPSERT"');
    expect(config).toContain('"MESSAGES_UPDATE"');
    expect(webhook).toContain("x-evolution-webhook-secret");
  });

  it("mantém identidade LID e credencial no Vault", () => {
    expect(identity).toContain("remoteJidAlt");
    expect(identity).toContain("@lid");
    expect(migration).toContain("gateway_secret_id");
    expect(migration).toContain("vault.decrypted_secrets");
    expect(migration).toContain("get_whatsapp_v2_qr_sender_context");
  });
});
