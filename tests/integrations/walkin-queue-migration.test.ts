import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = () => readFileSync(
  resolve(process.cwd(), "supabase/migrations/202608110004_walkin_queue_qr.sql"),
  "utf8",
);

const correctiveMigration = () => readFileSync(
  resolve(process.cwd(), "supabase/migrations/202608110005_walkin_queue_booking_status_fix.sql"),
  "utf8",
);

describe("migration da fila presencial", () => {
  it("cria identificador público estável e holds efêmeros tenant-safe", () => {
    const sql = migration();
    expect(sql).toContain("queue_public_id uuid");
    expect(sql).toContain("create table if not exists public.walkin_queue_holds");
    expect(sql).toContain("organization_id uuid not null");
    expect(sql).toContain("expires_at timestamptz not null");
  });

  it("expõe somente disponibilidade pública e promove hold durante reserva autenticada", () => {
    const sql = migration();
    expect(sql).toContain("create or replace function public.get_walkin_queue_availability");
    expect(sql).toContain("create or replace function public.create_walkin_queue_hold");
    expect(sql).toContain("p_walkin_queue_hold_id uuid default null");
    expect(sql).toContain("requested slot is no longer available");
  });

  it("consulta a função atual de status de reservas da organização", () => {
    const sql = correctiveMigration();
    expect(sql).toContain("public.organization_accepts_new_bookings(v_org.id)");
    expect(sql).not.toContain("and accepting_bookings");
  });
});
