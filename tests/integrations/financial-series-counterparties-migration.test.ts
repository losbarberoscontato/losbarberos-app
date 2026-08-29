import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20260829144054_financial_series_counterparties.sql", "utf8");

describe("financial series counterparties migration", () => {
  it("keeps counterparties and tags tenant-safe in generated entries", () => {
    expect(sql).toContain("add column counterparty_kind");
    expect(sql).toContain("customer must belong to this organization");
    expect(sql).toContain("active supplier is required");
    expect(sql).toContain("all tags must be active and tenant scoped");
    expect(sql).toContain("financial_entry_tags");
  });
});
