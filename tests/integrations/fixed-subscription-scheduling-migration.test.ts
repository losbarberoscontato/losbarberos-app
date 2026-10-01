import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = () => readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261001180732_fixed_subscription_scheduling.sql"),
  "utf8",
);

describe("migration de agendamento fixo de assinatura", () => {
  it("persiste a forma de agendamento no plano e na adesão, com chaves tenant-safe", () => {
    const sql = migration();
    expect(sql).toContain("add column scheduling_mode text not null default 'FREE'");
    expect(sql).toContain("fixed_schedule_cadence_weeks in (1, 2)");
    expect(sql).toContain("foreign key (fixed_schedule_barber_id, organization_id)");
    expect(sql).toContain("where id = p_plan_version_id and organization_id = p_organization_id");
  });

  it("usa o horário local da organização e pula bloqueios mantendo o intervalo de 7 ou 14 dias", () => {
    const sql = migration();
    expect(sql).toContain("(v_date + p_local_time) at time zone p_timezone");
    expect(sql).toContain("public.organization_date_blocked(p_organization_id, v_period)");
    expect(sql).toContain("p_cadence_weeks * 7");
    expect(sql).toContain("public.is_barber_available(p_organization_id, p_barber_id, v_period)");
  });

  it("gera a série dentro do registro do primeiro pagamento e aborta toda a transação em conflito", () => {
    const sql = migration();
    expect(sql).toContain("create or replace function public.schedule_fixed_subscription_sessions");
    expect(sql).toContain("public.create_manual_appointment(");
    expect(sql).toContain("fixed_schedule_conflict: escolha outra data, hora ou profissional");
    expect(sql).toContain("perform public.schedule_fixed_subscription_sessions(p_organization_id, v_sub.id)");
    expect(sql).toContain("fixed_schedule_created_at is not null then return 0");
  });

  it("limita edição da série ao gestor e antes da geração de reservas", () => {
    const sql = migration();
    expect(sql).toContain("if not public.is_organization_owner(p_organization_id) then");
    expect(sql).toContain("v_sub.status not in ('REQUESTED', 'PENDING_PAYMENT')");
    expect(sql).toContain("fixed_schedule_created_at is not null");
    expect(sql).toContain("from public, anon, authenticated");
  });
});
