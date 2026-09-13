import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260913145550_subscription_cancellation_session_linkage.sql",
  "utf8",
);

describe("subscription cancellation/session linkage migration contract", () => {
  it("links sessions through appointment_id and repairs the legacy rows", () => {
    expect(migration).toContain("customer_subscription_sessions_sync_appointment_link");
    expect(migration).toContain("a.subscription_session_id is distinct from s.id");
    expect(migration).toContain("s.appointment_id = a.id");
  });

  it("returns on-time cancellations to AVAILABLE and keeps late cancellations consumed", () => {
    expect(migration).toContain("coalesce(new.cancellation_outcome, 'AFTER_DEADLINE') = 'ON_TIME' then 'AVAILABLE'");
    expect(migration).toContain("coalesce(a.cancellation_outcome, 'AFTER_DEADLINE') = 'ON_TIME' then 'AVAILABLE'");
    expect(migration).toContain("appointment_id = null");
  });

  it("uses the same fallback for completed and no-show subscription appointments", () => {
    expect(migration).toContain("new.status in ('COMPLETED', 'NO_SHOW')");
    expect(migration).toContain("appointment_id = new.id");
  });
});
