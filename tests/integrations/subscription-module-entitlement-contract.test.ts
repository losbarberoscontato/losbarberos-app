import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260913162846_subscription_module_entitlement_contract.sql",
  "utf8",
);

describe("subscription module entitlement contract migration", () => {
  it("requires the manager addendum before enabling and records next-cycle billing intent", () => {
    expect(migration).toContain("accept_subscription_module_contract_and_enable");
    expect(migration).toContain("module contract acceptance required");
    expect(migration).toContain("billing_change_effective_at");
    expect(migration).toContain("billing_change_action");
    expect(migration).toContain("MANAGER_ENABLE_WITH_CONTRACT");
  });

  it("preserves active subscriptions while allowing their existing sessions to be booked", () => {
    expect(migration).toContain("customer_subscriptions_one_active_per_customer");
    expect(migration).toContain("v_sub.status <> 'ACTIVE'");
    expect(migration).not.toContain("if not public.organization_module_enabled(p_organization_id, 'subscription_plans') then");
  });

  it("keeps separate Stripe test and live price identifiers", () => {
    expect(migration).toContain("stripe_test_price_id");
    expect(migration).toContain("stripe_live_price_id");
    expect(migration).toContain("set_platform_module_price_catalog");
  });
});
