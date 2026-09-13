import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260913170127_owner_barber_profile.sql",
  "utf8",
);

describe("owner barber profile migration", () => {
  it("creates and backfills the manager professional with full app access", () => {
    expect(migration).toContain("add column if not exists is_manager boolean");
    expect(migration).toContain("ensure_owner_barber_profile");
    expect(migration).toContain("auth_user_id = p_user_id");
    expect(migration).toContain("app_access_enabled = true");
    expect(migration).toContain("agenda_access_scope = 'FULL'");
    expect(migration).toContain("cash_access_enabled = true");
    expect(migration).toContain("where role = 'OWNER' and active");
  });

  it("keeps manager email immutable at the UI contract boundary and grants operational resources", () => {
    expect(migration).toContain("login_email = coalesce(v_email, login_email)");
    expect(migration).toContain("barber_financial_account_permissions");
    expect(migration).toContain("barber_services");
    expect(migration).toContain("financial_account_owner_barber_access");
  });
});
