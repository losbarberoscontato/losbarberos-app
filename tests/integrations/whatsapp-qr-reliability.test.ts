import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("confiabilidade da conexão WhatsApp QR", () => {
  it("aceita QR nas formas de resposta documentadas e habilita QRCODE_UPDATED", () => {
    const start = read("supabase/functions/whatsapp-qr-start/index.ts");
    const config = read("supabase/functions/_shared/evolution-qr-webhook.ts");
    const webhook = read("supabase/functions/whatsapp-qr-webhook/index.ts");
    expect(start).toContain("payload?.qrcode?.base64");
    expect(start).toContain("payload?.data?.qrcode?.base64");
    expect(config).toContain('"QRCODE_UPDATED"');
    expect(config).toContain("base64: true");
    expect(webhook).toContain('event === "QRCODE_UPDATED"');
    expect(webhook).toContain("store_whatsapp_qr_code");
  });

  it("registra saúde, época da conexão e corta outbox anterior", () => {
    const migration = read("supabase/migrations/20260816140010_whatsapp_qr_reliability_health.sql");
    const health = read("supabase/functions/whatsapp-qr-health/index.ts");
    const status = read("supabase/functions/whatsapp-qr-status/index.ts");
    expect(migration).toContain("connection_epoch_at");
    expect(migration).toContain("STALE_BEFORE_QR_CONNECTION");
    expect(migration).toContain("GATEWAY_UNREACHABLE");
    expect(migration).toContain("los_barberos_health_whatsapp_qr");
    expect(health).toContain("/instance/connectionState/");
    expect(health).toContain("record_whatsapp_qr_health");
    expect(health).not.toContain("console.log");
    expect(status).toContain("requireOrganizationOwner");
    expect(status).toContain("preflight(request)");
    expect(status).toContain("connectionState/");
    expect(status).toContain("setTimeout(resolve, 2_000)");
    expect(status).toContain("attempt < 15");
    expect(status).toContain("PROVIDER_CONNECTING");
    expect(health).toContain("PROVIDER_CONNECTING");
  });
});
