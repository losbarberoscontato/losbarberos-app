import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("migration de ativaÃ§Ã£o de pacotes", () => {
  it("expÃµe RPC tenant-scoped para inativaÃ§Ã£o segura", () => {
    const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/202608060001_package_activation_rpc.sql"), "utf8");
    expect(sql).toContain("create or replace function public.set_package_active");
    expect(sql).toContain("p_organization_id uuid");
    expect(sql).toContain("p_package_id uuid");
    expect(sql).toContain("organization owner required");
    expect(sql).toContain("grant execute on function public.set_package_active");
  });
});
