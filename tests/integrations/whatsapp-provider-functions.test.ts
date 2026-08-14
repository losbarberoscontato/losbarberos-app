import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("WhatsApp provider functions", () => {
  it("declares secure start/callback functions for Meta and QR Web", () => {
    const metaStart = read("supabase/functions/whatsapp-embedded-signup-start/index.ts");
    const metaCallback = read("supabase/functions/whatsapp-embedded-signup-callback/index.ts");
    const metaShared = read("supabase/functions/_shared/whatsapp-meta.ts");
    const qrStart = read("supabase/functions/whatsapp-qr-start/index.ts");

    expect(metaStart).toContain("WHATSAPP_META_APP_ID");
    expect(metaStart).toContain("WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID");
    expect(metaShared).toContain("WHATSAPP_META_APP_SECRET");
    expect(metaCallback).toContain("metaGraphRequest");
    expect(metaCallback).not.toContain("return json(request, { accessToken");
    expect(qrStart).toContain("EVOLUTION_API_BASE_URL");
    expect(qrStart).toContain("EVOLUTION_API_KEY");
    expect(qrStart).toContain("EVOLUTION_WEBHOOK_SECRET");
    expect(qrStart).toContain("x-evolution-webhook-secret");
    expect(qrStart).toContain("whatsapp-qr-webhook");
    expect(metaStart).not.toContain("console.log");
    expect(metaCallback).not.toContain("console.log");
    expect(qrStart).not.toContain("console.log");
  });

  it("mantém callback Meta com retorno seguro e sem logs de credenciais", () => {
    const metaCallback = read("supabase/functions/whatsapp-embedded-signup-callback/index.ts");
    expect(metaCallback).toContain("safeReturnPath");
    expect(metaCallback).toContain("consume_whatsapp_connection_state");
    expect(metaCallback).toContain("META_BUSINESS_NOT_FOUND");
    expect(metaCallback).not.toContain("console.log");
  });

  it("registers provider endpoints without exposing JWT bypass to manager starts", () => {
    const config = read("supabase/config.toml");
    expect(config).toContain("[functions.whatsapp-embedded-signup-start]");
    expect(config).toContain("[functions.whatsapp-embedded-signup-callback]");
    expect(config).toContain("[functions.whatsapp-qr-start]");
    expect(config).toContain("verify_jwt = true");
  });
});
