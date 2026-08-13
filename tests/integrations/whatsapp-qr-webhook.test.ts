import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Evolution QR Web webhook", () => {
  it("valida assinatura antes de atualizar o estado tenant-safe", () => {
    const source = readFileSync(join(process.cwd(), "supabase", "functions", "whatsapp-qr-webhook", "index.ts"), "utf8");
    const migration = readFileSync(join(process.cwd(), "supabase", "migrations", "202608110006_whatsapp_hybrid_connections.sql"), "utf8");

    expect(source).toContain("x-evolution-signature");
    expect(source).toContain("verifyMetaSignature");
    expect(source).toContain("update_whatsapp_qr_status");
    expect(migration).toContain("update_whatsapp_qr_status");
    expect(source).not.toContain("console.log");
  });
});
