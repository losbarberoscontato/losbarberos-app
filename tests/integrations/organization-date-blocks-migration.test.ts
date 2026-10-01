import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = () => {
  const directory = join(process.cwd(), "supabase/migrations");
  const file = readdirSync(directory).find((name) => name.endsWith("_organization_date_blocks.sql"));
  if (!file) throw new Error("Migration de bloqueios por data não encontrada.");
  return readFileSync(join(directory, file), "utf8");
};

describe("migration de bloqueios por data", () => {
  it("cria armazenamento por organização, RLS e RPCs de gestão", () => {
    const sql = migration();
    expect(sql).toContain("create table public.organization_date_blocks");
    expect(sql).toContain("organization_id uuid not null");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("save_organization_date_block");
    expect(sql).toContain("delete_organization_date_block");
    expect(sql).toContain("is_organization_owner");
  });

  it("serializa reservas/bloqueios e barra criação, reagendamento, hold e confirmação", () => {
    const sql = migration();
    expect(sql).toContain("enforce_organization_date_blocks");
    expect(sql).toContain("for update");
    expect(sql).toContain("requested date is blocked");
    expect(sql).toContain("organization_date_block_conflict");
    expect(sql).toContain("HELD",);
    expect(sql).toContain("PENDING_PAYMENT");
    expect(sql).toContain("CONFIRMED");
    expect(sql).toContain("IN_SERVICE");
  });

  it("filtra disponibilidade de reserva e fila, mantendo eventos por sobreposição de horário", () => {
    const sql = migration();
    expect(sql).toContain("get_available_slots_unblocked");
    expect(sql).toContain("get_walkin_queue_availability_unblocked");
    expect(sql).toContain("block_type = 'EVENT'");
    expect(sql).toContain("start_time");
    expect(sql).toContain("end_time");
  });
});
