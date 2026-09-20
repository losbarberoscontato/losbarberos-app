import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const capabilitiesMigrationPath = resolve(process.cwd(), "supabase/migrations/20260828164510_catalog_future_commercial_capabilities.sql");
const durationMigrationPath = resolve(process.cwd(), "supabase/migrations/20260828183915_package_duration_override.sql");
const availabilityMigrationPath = resolve(process.cwd(), "supabase/migrations/20260916150000_service_availability.sql");
const internalAudienceMigrationPath = resolve(process.cwd(), "supabase/migrations/20260916173859_allow_internal_services_without_audience.sql");

describe("migration de elegibilidade comercial do catálogo", () => {
  it("mantém flags futuras nos dois catálogos e RPC tenant-safe", () => {
    expect(existsSync(capabilitiesMigrationPath)).toBe(true);
    const sql = readFileSync(capabilitiesMigrationPath, "utf8");
    expect(sql).toContain("add column accepts_subscription boolean not null default false");
    expect(sql).toContain("add column accepts_online_payment boolean not null default false");
    expect(sql).toContain("create or replace function public.save_package_with_items_v2");
    expect(sql).toContain("public.is_organization_owner(p_organization_id)");
    expect(sql).toContain("s.organization_id = p_organization_id");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = public, pg_temp");
    expect(sql).toContain("revoke all on function public.save_package_with_items_v2");
  });

  it("impede pacote de ativar regra que serviço incluído não aceita", () => {
    const sql = readFileSync(capabilitiesMigrationPath, "utf8");
    expect(sql).toContain("package subscription requires every included service to accept subscription");
    expect(sql).toContain("package online payment requires every included service to accept online payment");
    expect(sql).toContain("prevent_service_capability_conflict");
    expect(sql).toContain("disable subscription on dependent packages before disabling this service");
    expect(sql).toContain("disable online payment on dependent packages before disabling this service");
  });

  it("persiste duração editada e a usa para bloquear agenda", () => {
    expect(existsSync(durationMigrationPath)).toBe(true);
    const sql = readFileSync(durationMigrationPath, "utf8");
    expect(sql).toContain("add column duration_minutes integer");
    expect(sql).toContain("create or replace function public.save_package_with_items_v3");
    expect(sql).toContain("p_duration_minutes integer");
    expect(sql).toContain("v_duration := v_duration + coalesce(v_package.duration_minutes, v_package_derived_duration)");
    expect(sql).toContain("'duration_minutes', p.duration_minutes");
  });

  it("define disponibilidade cliente, oculto ou interno com proteção de pacote", () => {
    expect(existsSync(availabilityMigrationPath)).toBe(true);
    const sql = readFileSync(availabilityMigrationPath, "utf8");
    expect(sql).toContain("availability text not null default 'CLIENT'");
    expect(sql).toContain("availability in ('CLIENT', 'HIDDEN', 'INTERNAL')");
    expect(sql).toContain("internal service cannot be included in package");
    expect(sql).toContain("s.availability = 'CLIENT'");
  });

  it("permite serviço interno sem público", () => {
    expect(existsSync(internalAudienceMigrationPath)).toBe(true);
    const sql = readFileSync(internalAudienceMigrationPath, "utf8");
    expect(sql).toContain("tg_table_name = 'services'");
    expect(sql).toContain("availability");
    expect(sql).toContain("return new;");
    expect(sql).toContain("catalog item requires at least one audience");
  });
});
