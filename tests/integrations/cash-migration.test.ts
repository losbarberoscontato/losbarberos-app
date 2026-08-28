import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(process.cwd(), "supabase/migrations/202608090001_financial_cash.sql");

describe("financial cash migration contract", () => {
  it("ships tenant-safe ledgers and idempotent cash RPCs", () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain("create table public.financial_accounts");
    expect(sql).toContain("create table public.financial_entries");
    expect(sql).toContain("create table public.financial_settlements");
    expect(sql).toContain("create or replace function public.create_financial_transfer");
    expect(sql).toContain("organization owner required");
    expect(sql).toContain("idempotency key is required");
  });

  it("restores manual creation with competência and supports quinzenal series", () => {
    const seriesMigrationPath = join(process.cwd(), "supabase/migrations/20260828195635_financial_entry_series_form.sql");
    const sql = readFileSync(seriesMigrationPath, "utf8");
    expect(sql).toContain("add value if not exists 'BIWEEKLY'");
    expect(sql).toContain("competence_date, due_date");
    expect(sql).toContain("when 'BIWEEKLY' then r.start_date + ((v_i - 1) * 15)");
    expect(sql).toContain("perform public.require_financial_owner");
  });
});
