import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const shared = readFileSync(join(process.cwd(), "supabase", "functions", "_shared", "whatsapp.ts"), "utf8");
const sender = readFileSync(join(process.cwd(), "supabase", "functions", "whatsapp-send-outbox", "index.ts"), "utf8");
const webhook = readFileSync(join(process.cwd(), "supabase", "functions", "whatsapp-webhook", "index.ts"), "utf8");
const migration = readFileSync(join(process.cwd(), "supabase", "migrations", "202608110006_whatsapp_hybrid_connections.sql"), "utf8");

describe("roteamento tenant-safe do WhatsApp", () => {
  it("resolve o sender pelo tenant e mantém segredo somente server-side", () => {
    expect(shared).toContain("whatsappSenderForOrganization");
    expect(sender).toContain("whatsappSenderForOrganization");
    expect(sender).not.toContain("defaultWhatsAppSender");
    expect(shared).toContain("get_whatsapp_sender_context");
    expect(migration).toContain("get_whatsapp_sender_context");
    expect(migration).toContain("vault.decrypted_secrets");
    expect(migration).toContain("perform public.require_service_role()");
  });

  it("roteia status Meta pelo Phone Number ID recebido no webhook", () => {
    expect(webhook).toContain("p_phone_number_id");
    expect(webhook).toContain("change.value?.metadata?.phone_number_id");
    expect(migration).toContain("process_whatsapp_delivery_status");
  });
});
