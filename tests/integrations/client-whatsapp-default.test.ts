import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("consentimento WhatsApp padrão do cliente", () => {
  it("habilita novos vínculos e preserva uma decisão anterior do cliente", () => {
    const migration = read("supabase/migrations/20260816220148_client_whatsapp_transactional_default.sql");
    expect(migration).toContain("customers_grant_default_client_whatsapp_transactional_consent");
    expect(migration).toContain("CLIENT_ACCOUNT_DEFAULT");
    expect(migration).toContain("CLIENT_ACCOUNT_DEFAULT_BACKFILL");
    expect(migration).toContain("not exists");
    expect(migration).toContain("WHATSAPP_TRANSACTIONAL");
  });
});
