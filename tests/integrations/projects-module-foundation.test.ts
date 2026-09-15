import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260914014549_projects_module_foundation.sql",
  "utf8",
);
const reactivationFixMigration = readFileSync(
  "supabase/migrations/20260914114816_projects_module_reactivation_return_fix.sql",
  "utf8",
);
const operationalMigration = readFileSync(
  "supabase/migrations/20260915013716_projects_module_operational_core.sql",
  "utf8",
);

describe("projects module foundation migration", () => {
  it("registers the module, contract and default owner activation", () => {
    expect(migration).toContain("'projects'");
    expect(migration).toContain("julioheidenn@gmail.com");
    expect(migration).toContain("platform_module_contract_versions");
    expect(migration).toContain("accept_module_contract_and_enable");
  });

  it("records the 60-day reactivation window and expiry job", () => {
    expect(migration).toContain("data_retention_until");
    expect(migration).toContain("interval '60 days'");
    expect(migration).toContain("process_expired_project_module_retention");
    expect(migration).toContain("PENDING_DELETION");
    expect(migration).toContain("DELETED");
  });

  it("assigns the composite entitlement return without scalar casting", () => {
    expect(migration).toContain("v_row := public.set_organization_module_enabled(p_organization_id, p_module_key, true);");
    expect(migration).not.toContain("select public.set_organization_module_enabled(p_organization_id, p_module_key, true)\n    into v_row");
    expect(reactivationFixMigration).toContain("v_row := public.set_organization_module_enabled(p_organization_id, p_module_key, true);");
  });

  it("creates the tenant-scoped operational core and atomic project bootstrap", () => {
    expect(operationalMigration).toContain("create table public.projects");
    expect(operationalMigration).toContain("create table public.project_engagements");
    expect(operationalMigration).toContain("create table public.project_engagement_steps");
    expect(operationalMigration).toContain("create or replace function public.create_project_with_initial_package");
    expect(operationalMigration).toContain("public.organization_module_enabled(p_organization_id, 'projects')");
    expect(operationalMigration).toContain("alter table public.%I force row level security");
    expect(operationalMigration).toContain("delete from public.projects where organization_id = v_row.organization_id");
  });
});
