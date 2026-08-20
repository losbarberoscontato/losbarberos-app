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

  it("sincroniza opt-out na fila V2 e não cria mensagens futuras ao cliente", () => {
    const migration = read("supabase/migrations/20260820215338_enforce_whatsapp_transactional_opt_out_v2.sql");
    expect(migration).toContain("consent_events_sync_whatsapp_v2_transactional_preference");
    expect(migration).toContain("WHATSAPP_TRANSACTIONAL_OPTED_OUT");
    expect(migration).toContain("BOOKING_CREATED_CLIENT");
    expect(migration).toContain("REMINDER_MORNING_CLIENT");
    expect(migration).toContain("REMINDER_T45_CLIENT");
    expect(migration).toContain("v_client_consented := public.whatsapp_v2_consented");
    expect(migration).toContain("BOOKING_CREATED_STAFF");
  });
});
