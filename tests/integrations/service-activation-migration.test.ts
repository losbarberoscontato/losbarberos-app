import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("migration de ativação de serviços", () => {
  it("expõe RPC tenant-scoped para alterar somente o status", () => {
    const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/202608060003_service_activation_rpc.sql"), "utf8");
    expect(sql).toContain("create or replace function public.set_service_active");
    expect(sql).toContain("p_organization_id uuid");
    expect(sql).toContain("p_service_id uuid");
    expect(sql).toContain("where id = p_service_id and organization_id = p_organization_id");
    expect(sql).toContain("organization owner required");
    expect(sql).toContain("grant execute on function public.set_service_active");
  });

  it("fixa o intervalo de slots da agenda em 15 minutos", () => {
    const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/202608060004_slot_interval_15_minutes.sql"), "utf8");
    expect(sql).toContain("update public.organizations");
    expect(sql).toContain("set slot_interval_minutes = 15");
    expect(sql).toContain("check (slot_interval_minutes = 15)");
  });
});
