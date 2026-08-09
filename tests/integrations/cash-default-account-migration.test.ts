import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(process.cwd(), "supabase/migrations/202608090003_cash_default_account.sql");

describe("default financial account migration contract", () => {
  it("provisions tenant-safe Caixa Físico and its manual counter mapping", () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("add column description text");
    expect(sql).toContain("Caixa Físico");
    expect(sql).toContain("Caixa físico para recebimento à vista em dinheiro físico.");
    expect(sql).toContain("seed_default_financial_accounts");
    expect(sql).toContain("MANUAL");
    expect(sql).toContain("COUNTER");
    expect(sql).toContain("organizations_seed_default_financial_accounts");
    expect(sql).toContain("revoke all on function public.seed_default_financial_accounts(uuid) from public, anon, authenticated");
  });
});
