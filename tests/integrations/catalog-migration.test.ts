import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(process.cwd(), "supabase/migrations/202608050001_catalog_audiences.sql");

describe("migration de públicos do catálogo", () => {
  it("adiciona públicos validados e mantém projeção pública filtrada", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain("alter table public.services");
    expect(sql).toContain("alter table public.packages");
    expect(sql).toContain("OUTROS_SERVICOS");
    expect(sql).toContain("save_package_with_items");
    expect(sql).toContain("get_public_booking_context");
    expect(sql).toContain("cardinality(s.audiences) > 0");
    expect(sql).toContain("p_audiences");
  });
});
