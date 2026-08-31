import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = () => readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260831132312_booking_hold_concurrency.sql"),
  "utf8",
);

describe("migration de concorrência dos holds de agendamento", () => {
  it("fixa novos holds em três minutos e atualiza organizações existentes", () => {
    const sql = migration();
    expect(sql).toContain("alter column hold_duration_minutes set default 3");
    expect(sql).toMatch(/update public\.organizations\s+set hold_duration_minutes = 3/u);
  });

  it("remove a overload insegura e redefine a compatível sobre o novo ciclo", () => {
    const sql = migration();
    expect(sql).toMatch(
      /drop function if exists public\.create_appointment_hold\(\s*uuid, uuid, uuid, timestamptz, jsonb, public\.payment_mode\s*\)/u,
    );
    expect(sql).toMatch(
      /drop function if exists public\.create_appointment_hold\(\s*uuid, uuid, uuid, timestamptz, jsonb, public\.payment_mode, uuid\s*\)/u,
    );
    expect(sql).toContain("create or replace function public.create_appointment_hold");
    expect(sql).toContain("v_hold := public.create_customer_booking_hold");
    expect(sql).toContain("v_confirmed := public.confirm_customer_booking_hold");
  });

  it("exclui holds QR ativos da disponibilidade normal", () => {
    const sql = migration();
    expect(sql).toContain("create or replace function public.get_available_slots_legacy_window");
    expect(sql).toMatch(/from public\.walkin_queue_holds h[\s\S]*h\.expires_at > now\(\)[\s\S]*h\.service_period && v_period/u);
  });

  it("adquire período completo com idempotência e confirmação separada", () => {
    const sql = migration();
    expect(sql).toContain("create or replace function public.create_customer_booking_hold");
    expect(sql).toContain("p_idempotency_key uuid");
    expect(sql).toContain("'HELD', 'CUSTOMER', v_period, v_expires_at");
    expect(sql).toContain("create or replace function public.confirm_customer_booking_hold");
    expect(sql).toContain("create or replace function public.release_customer_booking_hold");
    expect(sql).toContain("customer already has an active booking hold");
    expect(sql).toContain("appointment is not a customer counter booking hold");
    expect(sql).toContain("customer_booking_hold_confirmed");
    expect(sql).toContain("customer_booking_hold_released");
    expect(sql.match(/from public\.barbers[\s\S]*?for update/giu)?.length).toBeGreaterThanOrEqual(2);
  });

  it("libera hold vencido também na disponibilidade da fila QR", () => {
    const sql = migration();
    expect(sql).toContain("create or replace function public.get_walkin_queue_availability");
    expect(sql).toMatch(/a\.status in \('HELD', 'PENDING_PAYMENT'\) and a\.hold_expires_at > now\(\)/u);
  });

  it("mantém constraint GiST como autoridade final de concorrência", () => {
    const sql = migration();
    expect(sql).toContain("when exclusion_violation then");
    expect(sql).toContain("requested slot is no longer available");
    expect(sql).toContain("create or replace function public.expire_conflicting_appointment_holds");
    expect(sql).toContain("and a.service_period && p_service_period");
    expect(sql).not.toContain("perform public.expire_stale_appointment_holds(1000)");
  });
});
