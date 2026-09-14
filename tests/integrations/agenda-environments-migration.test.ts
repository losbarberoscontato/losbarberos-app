import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260914224759_agenda_environments.sql",
  "utf8",
);
const reorderMigration = readFileSync(
  "supabase/migrations/20260914230246_agenda_environment_reorder.sql",
  "utf8",
);
const correctionsMigration = readFileSync(
  "supabase/migrations/20260914231214_agenda_environment_corrections.sql",
  "utf8",
);

describe("agenda environments migration", () => {
  it("creates tenant-scoped ordered environments and seeds the two defaults", () => {
    expect(migration).toContain("create table public.agenda_environments");
    expect(migration).toContain("Sala/Cadeira 1");
    expect(migration).toContain("Sala/Cadeira 2");
    expect(migration).toContain("organization_id uuid not null references public.organizations");
    expect(migration).toContain("agenda_environments_location_order_key");
  });

  it("keeps legacy assignment auditable and adds physical capacity constraints", () => {
    expect(migration).toContain("agenda_environment_assignment_issues");
    expect(migration).toContain("NO_ENVIRONMENT_CAPACITY_FOR_LEGACY_APPOINTMENT");
    expect(migration).toContain("work_intervals_environment_no_overlap");
    expect(migration).toContain("appointments_no_environment_overlap");
    expect(migration).toContain("environment_id is null");
  });

  it("resolves public bookings without exposing environment selection and requires explicit manager capacity", () => {
    expect(migration).toContain("create or replace function public.resolve_appointment_environment");
    expect(migration).toContain("create or replace function public.is_barber_available");
    expect(migration).toContain("create or replace function public.create_manual_appointment(");
    expect(migration).toContain("p_environment_id uuid");
    expect(migration).toContain("app.agenda_environment_id");
  });

  it("rejects inactive environments for new schedule and reservation writes", () => {
    expect(migration).toContain("active work interval requires an environment");
    expect(migration).toContain("available exception requires an environment");
    expect(migration).toContain("environment is inactive");
    expect(migration).toContain("no active environment available for requested period");
  });

  it("reorders active environments transactionally", () => {
    expect(reorderMigration).toContain("reorder_agenda_environment");
    expect(reorderMigration).toContain("sort_order + 10000");
    expect(reorderMigration).toContain("is_organization_owner");
  });

  it("keeps automatic manager allocation and corrects requested order positions", () => {
    expect(correctionsMigration).toContain("set_config('app.agenda_environment_id'");
    expect(correctionsMigration).not.toContain("environment is required for manager booking");
    expect(correctionsMigration).toContain("e.sort_order - 10000 + 1");
    expect(correctionsMigration).toContain("greatest(v_count, 1)");
  });
});
