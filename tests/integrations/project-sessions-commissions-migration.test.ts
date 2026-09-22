import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260921222752_project_sessions_and_commissions.sql", "utf8");
const backfillMigration = readFileSync("supabase/migrations/20260922122126_backfill_project_engagement_sessions.sql", "utf8");
const environmentAvailabilityMigration = readFileSync("supabase/migrations/20260922144849_project_session_environment_availability.sql", "utf8");
const environmentAvailabilityFixMigration = readFileSync("supabase/migrations/20260922150000_fix_project_session_environment_availability.sql", "utf8");
const internalServicesMigration = readFileSync("supabase/migrations/20260922192330_project_engagement_internal_services.sql", "utf8");

describe("project sessions and package commissions migration", () => {
  it("creates tenant-scoped internal services and generates their payable commission atomically", () => {
    expect(internalServicesMigration).toContain("unique (engagement_id, kanban_board_id)");
    expect(internalServicesMigration).toContain("project_engagement_internal_service_move_guard");
    expect(internalServicesMigration).toContain("project_internal_service_responsible_guard");
    expect(internalServicesMigration).toContain("project_internal_service_commission_guard");
    expect(internalServicesMigration).toContain("public.is_organization_owner(organization_id)");
    expect(internalServicesMigration).toContain("v_board.responsible_barber_id");
    expect(internalServicesMigration).toContain("create or replace function public.upsert_project_engagement_internal_service");
    expect(internalServicesMigration).toContain("create or replace function public.complete_project_engagement_internal_service");
    expect(internalServicesMigration).toContain("project-internal-service:");
    expect(internalServicesMigration).toContain("'PROJECT_INTERNAL'::text source_type");
    expect(internalServicesMigration).toContain("coalesce(detail.appointment_item_id, detail.internal_service_id)");
  });

  it("creates tenant-scoped sessions and the project booking RPC", () => {
    expect(migration).toContain("add value if not exists 'PROJECT'");
    expect(migration).toContain("create table public.project_engagement_sessions");
    expect(migration).toContain("unique (engagement_id, session_number)");
    expect(migration).toContain("public.create_project_appointment");
    expect(migration).toContain("project_session_booking");
    expect(migration).toContain("project_engagement_sessions_owner_all");
  });

  it("generates the package commission only when a project appointment is completed", () => {
    expect(migration).toContain("source = 'PROJECT'");
    expect(migration).toContain("commission_mode_snapshot, commission_fixed_cents_snapshot");
    expect(migration).toContain("v_assignment.commission_cents");
    expect(migration).toContain("when new.status = 'COMPLETED' then 'COMPLETED'");
    expect(migration).toContain("is_project");
  });

  it("backfills sessions for active contracts created before the feature", () => {
    expect(backfillMigration).toContain("where engagement.status = 'ACTIVE'");
    expect(backfillMigration).toContain("generate_series");
    expect(backfillMigration).toContain("on conflict (engagement_id, session_number) do nothing");
  });

  it("only offers and accepts environments assigned to the selected professional", () => {
    expect(environmentAvailabilityMigration).toContain("public.get_project_session_environments");
    expect(environmentAvailabilityMigration).toContain("wi.environment_id = e.id");
    expect(environmentAvailabilityMigration).toContain("a.environment_id = e.id");
    expect(environmentAvailabilityMigration).toContain("environment is not assigned to barber for requested period");
    expect(environmentAvailabilityMigration).toContain("environment is no longer available");
  });

  it("qualifies ids in the availability RPC to avoid RETURNS TABLE name collisions", () => {
    expect(environmentAvailabilityFixMigration).toContain("from public.organizations o");
    expect(environmentAvailabilityFixMigration).toContain("where o.id = p_organization_id");
    expect(environmentAvailabilityFixMigration).toContain("from public.project_engagement_sessions s");
    expect(environmentAvailabilityFixMigration).toContain("where s.id = p_session_id");
    expect(environmentAvailabilityFixMigration).toContain("from public.project_engagements pe");
    expect(environmentAvailabilityFixMigration).toContain("where pe.id = v_session.engagement_id");
  });
});
