import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260921222752_project_sessions_and_commissions.sql", "utf8");
const backfillMigration = readFileSync("supabase/migrations/20260922122126_backfill_project_engagement_sessions.sql", "utf8");

describe("project sessions and package commissions migration", () => {
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
});
