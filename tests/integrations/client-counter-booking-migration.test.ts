import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202608110001_client_counter_booking_availability.sql"),
  "utf8",
).toLowerCase();

describe("migration de agenda cliente sem pagamento antecipado", () => {
  it("limita disponibilidade a quinze dias e agrega opções por data", () => {
    expect(sql).toContain("create or replace function public.get_available_slots(");
    expect(sql).toContain("+ 15");
    expect(sql).not.toContain("+ 180");
    expect(sql).toMatch(/revoke all on function public\.get_available_slots_legacy_window\(text, uuid, date, jsonb\)\s+from public, anon, authenticated/u);
    expect(sql).toContain("create or replace function public.get_available_slots_for_date(");
    expect(sql).toContain("'options'");
  });

  it("confirma novos agendamentos de cliente somente para pagamento no atendimento", () => {
    expect(sql).toContain("p_payment_mode <> 'counter'");
    expect(sql).toContain("customer booking supports only counter payment mode");
    expect(sql).toContain("'confirmed', 'customer'");
    expect(sql).toContain("'counter'");
    expect(sql).toContain("deposit_bps_snapshot");
    expect(sql).toContain("0, 0");
    expect(sql).toContain("'amount_due_now_cents', 0");
  });
});
