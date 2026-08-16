import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("automação WhatsApp QR Web", () => {
  const migration = read("supabase/migrations/20260816124514_whatsapp_qr_automation.sql");
  const sender = read("supabase/functions/whatsapp-send-outbox/index.ts");
  const shared = read("supabase/functions/_shared/whatsapp.ts");
  const qrStart = read("supabase/functions/whatsapp-qr-start/index.ts");
  const qrWebhook = read("supabase/functions/whatsapp-qr-webhook/index.ts");
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

  it("usa contrato de botões e resposta Evolution", () => {
    expect(qrStart).toContain('"MESSAGES_UPSERT"');
    expect(qrWebhook).toContain("buttonsResponseMessage");
    expect(qrWebhook).toContain("process_whatsapp_action_token");
    expect(sender).toContain("EVOLUTION_REMINDER_BUTTONS");
    expect(shared).toContain("sendButtons");
    expect(sender).toContain("buttonId");
    expect(sender).toContain("result.key?.id");
    expect(shared).toContain("sendText");
  });
});
