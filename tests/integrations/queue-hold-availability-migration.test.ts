import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = () => readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260831165234_queue_hold_visible_in_booking_availability.sql"),
  "utf8",
);

describe("disponibilidade do hold da fila no agendamento", () => {
  it("expõe overload autenticada que recebe o hold da fila", () => {
    const sql = migration();
    expect(sql).toContain("p_walkin_queue_hold_id uuid");
    expect(sql).toContain("public.get_available_slots(");
    expect(sql).toContain("h.id <> p_walkin_queue_hold_id");
    expect(sql).toContain("grant execute on function public.get_available_slots(text, uuid, date, jsonb, uuid) to authenticated");
  });
});
