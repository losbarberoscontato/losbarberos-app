import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261101191625_manager_appointment_environment_availability.sql",
  "utf8",
);

describe("manager appointment environment availability migration", () => {
  it("restricts room and time options to the manager organization and assigned professional", () => {
    expect(migration).toContain("public.is_organization_owner(p_organization_id)");
    expect(migration).toContain("b.organization_id = p_organization_id");
    expect(migration).toContain("public.get_available_slots(v_org.slug, p_barber_id, p_local_date, p_selections)");
    expect(migration).toContain("public.resolve_appointment_environment(");
    expect(migration).toContain("public.organization_date_blocked(p_organization_id, v_period)");
  });

  it("exposes the lookup only to authenticated managers", () => {
    expect(migration).toContain("security definer");
    expect(migration).toContain("revoke all on function public.get_manager_appointment_environment_slots(uuid, uuid, date, jsonb) from public, anon");
    expect(migration).toContain("grant execute on function public.get_manager_appointment_environment_slots(uuid, uuid, date, jsonb) to authenticated");
  });
});
