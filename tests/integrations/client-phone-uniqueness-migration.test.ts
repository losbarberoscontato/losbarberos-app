import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202608110002_client_phone_non_unique.sql"),
  "utf8",
).toLowerCase();

describe("client phone uniqueness migration", () => {
  it("removes tenant phone uniqueness while preserving identity uniqueness", () => {
    expect(sql).toContain("drop index if exists public.customers_phone_per_organization");
    expect(sql).not.toContain("create unique index customers_phone_per_organization");
    expect(sql).not.toContain("drop index if exists public.customers_one_identity_per_organization");
  });
});
