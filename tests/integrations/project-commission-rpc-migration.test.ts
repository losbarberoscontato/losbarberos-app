import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260923033000_project_commission_details_rpc.sql"), "utf8");

describe("project commission RPC migration", () => {
  it("filters project appointments before aggregating financial data", () => {
    expect(sql).toContain("create or replace function public.get_project_commission_details");
    expect(sql).toContain("join project_appointments project_appointment");
    expect(sql).toContain("p_project_ids");
    expect(sql).toContain("grant execute on function public.get_project_commission_details(uuid, uuid[]) to authenticated");
  });
});
