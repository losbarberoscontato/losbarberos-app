import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260903154708_barber_app_and_individual_cash.sql"), "utf8");

describe("barber app migration", () => {
  it("keeps access, agenda and cash rules tenant-scoped", () => {
    expect(migration).toContain("add column login_email");
    expect(migration).toContain("barber_financial_account_permissions");
    expect(migration).toContain("barber_cash_sessions");
    expect(migration).toContain("organization_id uuid not null");
    expect(migration).toContain("unique (id, organization_id)");
    expect(migration).toContain("can_operate_barber_agenda");
  });

  it("uses append-only payment events and manager reconciliation", () => {
    expect(migration).toContain("payment_transactions");
    expect(migration).toContain("adjust_barber_cash_receipt");
    expect(migration).toContain("'REVERSAL'");
    expect(migration).toContain("reconcile_barber_cash_session");
    expect(migration).not.toContain("delete from public.payment_transactions");
  });

  it("does not grant privileged cash mutations to anonymous users", () => {
    expect(migration).toContain("from public, anon");
    expect(migration).toContain("to authenticated");
  });
});
