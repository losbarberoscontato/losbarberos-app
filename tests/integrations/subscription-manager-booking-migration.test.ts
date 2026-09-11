import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260911163232_subscription_manager_booking_and_session_flow.sql",
  "utf8",
);

describe("subscription manager booking migration contract", () => {
  it("allows owner and customer callers without weakening tenant/session guards", () => {
    expect(migration).toContain("public.is_organization_owner(p_organization_id)");
    expect(migration).toContain("public.is_organization_customer(p_organization_id, p_customer_id)");
    expect(migration).toContain("v_sub.customer_id <> p_customer_id");
    expect(migration).toContain("v_session.status <> 'AVAILABLE'");
  });

  it("creates confirmed subscription appointments and consumes the available session atomically", () => {
    expect(migration).toContain("public.create_manual_appointment(");
    expect(migration).toContain("public.create_appointment_hold(");
    expect(migration).toContain("'service_id', service_id");
    expect(migration).toContain("payment_mode = 'SUBSCRIPTION'");
    expect(migration).toContain("status = 'SCHEDULED', appointment_id = v_appointment_id");
    expect(migration).toContain("'status', 'CONFIRMED'");
  });
});
