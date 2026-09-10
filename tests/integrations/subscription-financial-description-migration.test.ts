import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260910222156_subscription_financial_entry_description.sql",
);

describe("subscription financial description migration contract", () => {
  it("derives readable service, professional, session and installment references", () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("subscription_financial_entry_description");
    expect(sql).toContain("string_agg(ps.service_name_snapshot");
    expect(sql).toContain("Profissional não definido");
    expect(sql).toContain("Parcela %s/%s, Ref. %s");
    expect(sql).toContain("update public.financial_entries e");
  });

  it("keeps subscription receipt settlement and idempotency intact", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("perform public.settle_financial_entry");
    expect(sql).toContain("subscription-payment-settlement:' || p_idempotency_key");
    expect(sql).toContain("idempotency_key = p_idempotency_key");
  });
});
