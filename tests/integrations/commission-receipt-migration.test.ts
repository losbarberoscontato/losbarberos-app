import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(process.cwd(), "supabase/migrations/20260907134240_commissions_paid_after_receipt.sql");
const partialPayoutMigrationPath = resolve(process.cwd(), "supabase/migrations/20260907143410_commission_partial_payout.sql");

describe("commission receipt migration contract", () => {
  it("gates earned commission by full appointment receipt and keeps the operation idempotent", () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain("appointment_is_fully_received");
    expect(sql).toContain("commission_ledger_received_guard");
    expect(sql).toContain("payment_transactions_commission_after_insert");
    expect(sql).toContain("on conflict (organization_id, idempotency_key) do nothing");
    expect(sql).toContain("specific service");
    expect(sql).toContain("create or replace view public.commission_service_details");
    expect(sql).toContain("create or replace function public.pay_commission");
    expect(sql).toContain("commission_payout_settlements");
  });

  it("includes commission payouts as cash outflows in financial account balances", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain("from public.commission_payout_settlements");
    expect(sql).toContain("-amount_cents::bigint");
  });

  it("pays only selected open service commissions and keeps the amount database-authoritative", () => {
    expect(existsSync(partialPayoutMigrationPath)).toBe(true);
    const sql = readFileSync(partialPayoutMigrationPath, "utf8");
    expect(sql).toContain("p_appointment_item_ids uuid[]");
    expect(sql).toContain("at least one commission must be selected");
    expect(sql).toContain("selected commission is not open in the requested period");
    expect(sql).toContain("selected commission is already reserved for payment");
    expect(sql).toContain("v_amount := v_amount + v_ledger.amount_cents");
    expect(sql).toContain("set amount_cents = v_amount");
  });
});
