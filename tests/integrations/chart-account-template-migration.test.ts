import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(process.cwd(), "supabase/migrations/202608090002_chart_account_templates.sql");

describe("chart-account template migration contract", () => {
  it("ships the 42-account PDF template and safe organization provisioning", () => {
    expect(existsSync(migrationPath)).toBe(true);

    const sql = readFileSync(migrationPath, "utf8");
    const templateRows = [...sql.matchAll(/^\s*\('([0-9.]+)', '[^']+', '(REVENUE|EXPENSE)', (?:null|'[0-9.]+')\),?$/gm)];

    expect(sql).toContain("create table public.default_chart_account_templates");
    expect(sql).toContain("create or replace function public.seed_default_chart_of_accounts");
    expect(sql).toContain("create trigger organizations_seed_default_chart_accounts");
    expect(sql).toContain("create or replace function public.replace_chart_of_accounts_from_default");
    expect(sql).toContain("financial entries reference the current chart of accounts");
    expect(sql).toContain("revoke all on function public.replace_chart_of_accounts_from_default(uuid) from public, anon, authenticated");
    expect(templateRows).toHaveLength(42);
    expect(templateRows.filter(([, , kind]) => kind === "REVENUE")).toHaveLength(12);
    expect(templateRows.filter(([, , kind]) => kind === "EXPENSE")).toHaveLength(30);
    expect(templateRows.map((match) => match[1])).toEqual(expect.arrayContaining(["1", "1.1", "1.1.1", "2", "2.8.2"]));
  });
});
