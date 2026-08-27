import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(process.cwd(), "supabase/migrations/20260827170641_finance_reporting.sql");

describe("finance reporting migration contract", () => {
  it("keeps source ledgers authoritative and scopes new financial data by tenant", () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain("create or replace view public.financial_reporting_facts");
    expect(sql).toContain("security_invoker = true");
    expect(sql).toContain("create table public.appointment_receipt_classifications");
    expect(sql).toContain("create table public.financial_series");
    expect(sql).toContain("create table public.financial_budget_versions");
    expect(sql).toContain("record_manual_appointment_receipt_v2");
    expect(sql).toContain("perform public.require_financial_owner");
    expect(sql).toContain("idempotency key belongs to another commission payout");
  });
});
