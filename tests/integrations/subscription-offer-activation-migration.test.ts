import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261024164738_activate_subscription_offer_on_customer_acceptance.sql",
  "utf8",
);

describe("manager subscription offer acceptance migration", () => {
  it("activates only an offer belonging to the authenticated customer", () => {
    expect(migration).toContain("public.is_organization_customer(p_organization_id, v_sub.customer_id)");
    expect(migration).toContain("v_sub.status <> 'REQUESTED' or v_sub.contract_accepted_at is not null");
    expect(migration).toContain("set status = 'ACTIVE'");
    expect(migration).toContain("contract_accepted_by = auth.uid()");
  });

  it("creates every billing cycle and its configured sessions in the acceptance transaction", () => {
    expect(migration).toContain("v_cycle_count := case");
    expect(migration).toContain("insert into public.customer_subscription_cycles(");
    expect(migration).toContain("for j in 1..v_plan.sessions_per_cycle loop");
    expect(migration).toContain("insert into public.customer_subscription_sessions(");
  });

  it("uses the organization-local acceptance date and makes retries idempotent", () => {
    expect(migration).toContain("now() at time zone v_timezone");
    expect(migration).toContain("if v_sub.status = 'ACTIVE' and v_sub.contract_accepted_by = auth.uid() then");
    expect(migration).toContain("'client-offer-activated:' || v_sub.id");
  });
});
