import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260915172127_projects_packages_pricing.sql", "utf8");

describe("projects package pricing migration", () => {
  it("stores the pricing inputs and normalized professionals relation", () => {
    expect(migration).toContain("add column duration_minutes integer");
    expect(migration).toContain("add column suggested_price_cents bigint");
    expect(migration).toContain("create table public.project_package_barbers");
    expect(migration).toContain("foreign key (project_package_id, organization_id)");
    expect(migration).toContain("foreign key (barber_id, organization_id)");
  });

  it("protects the four active package limit and calculates the suggested price", () => {
    expect(migration).toContain("project package limit reached");
    expect(migration).toContain("v_suggested_price := greatest(0, round(v_cost_total / v_denominator)::bigint)");
    expect(migration).toContain("v_cost_total := (p_fixed_cost_per_hour_cents * p_sessions_count) + p_extra_costs_cents");
    expect(migration).toContain("pricing rates must be below 100%");
    expect(migration).toContain("upsert_project_package");
  });
});

describe("projects investments migration", () => {
  it("creates tenant-scoped cost categories and owner RPCs", () => {
    const sql = readFileSync("supabase/migrations/20260915183655_projects_investments_costs.sql", "utf8");
    expect(sql).toContain("create table public.project_cost_items");
    expect(sql).toContain("kind text not null check (kind in ('FIXED', 'VARIABLE', 'INVESTMENT'))");
    expect(sql).toContain("public.upsert_project_cost_item");
    expect(sql).toContain("public.delete_project_cost_item");
    expect(sql).toContain("public.is_organization_owner(p_organization_id)");
    expect(sql).toContain("alter table public.project_cost_items force row level security");
  });
});

describe("projects package services migration", () => {
  it("keeps selected services tenant-scoped and ordered", () => {
    const sql = readFileSync("supabase/migrations/20260916140000_project_package_services.sql", "utf8");
    expect(sql).toContain("create table if not exists public.project_package_services");
    expect(sql).toContain("foreign key (project_package_id, organization_id)");
    expect(sql).toContain("foreign key (service_id, organization_id)");
    expect(sql).toContain("force row level security");
  });
});

describe("project package service commissions migration", () => {
  it("stores each package service and eligible professional commission in tenant scope", () => {
    const sql = readFileSync("supabase/migrations/20260921140746_project_package_service_commissions.sql", "utf8");
    expect(sql).toContain("create table public.project_package_service_assignments");
    expect(sql).toContain("commission_cents bigint not null check (commission_cents >= 0)");
    expect(sql).toContain("unique (project_package_id, service_id, barber_id)");
    expect(sql).toContain("foreign key (project_package_id, organization_id)");
    expect(sql).toContain("foreign key (service_id, organization_id)");
    expect(sql).toContain("foreign key (barber_id, organization_id)");
    expect(sql).toContain("force row level security");
    expect(sql).toContain("project_package_service_assignments_owner_select");
    expect(sql).toContain("grant select on public.project_package_service_assignments to authenticated");
  });

  it("validates service eligibility and persists package prices and commissions atomically", () => {
    const sql = readFileSync("supabase/migrations/20260921140746_project_package_service_commissions.sql", "utf8");
    expect(sql).toContain("p_service_assignments jsonb");
    expect(sql).toContain("public.barber_services");
    expect(sql).toContain("bs.active");
    expect(sql).toContain("v_commission_total");
    expect(sql).toContain("p_extra_costs_cents + v_commission_total");
    expect(sql).toContain("insert into public.project_package_service_assignments");
    expect(sql).toContain("delete from public.project_package_service_assignments");
  });
});
