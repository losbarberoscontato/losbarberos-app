import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(process.cwd(), "supabase/migrations/20260905231035_financial_receivables_from_appointments.sql");

describe("financial receivables migration contract", () => {
  it("allows receipt only for active appointments, keeps the RPC tenant-safe, and preserves idempotency", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain("v_appointment.status not in ('CONFIRMED', 'IN_SERVICE', 'COMPLETED')");
    expect(sql).not.toContain("only completed appointment can be received");
    expect(sql).toContain("perform public.require_financial_owner(v_appointment.organization_id, 'appointment receipt')");
    expect(sql).toContain("pt.organization_id = v_appointment.organization_id");
    expect(sql).toContain("grant execute on function public.record_manual_appointment_receipt_v2");
  });
});
