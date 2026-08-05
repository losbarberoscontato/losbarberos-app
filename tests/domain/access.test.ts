import { describe, expect, it } from "vitest";
import { canPerformTenantAction } from "@/lib/domain/access";

describe("tenant billing access matrix", () => {
  it("keeps full access during grace", () => {
    expect(canPerformTenantAction("GRACE", "create_booking")).toBe(true);
    expect(canPerformTenantAction("GRACE", "reschedule")).toBe(true);
  });

  it("keeps existing obligations but blocks new bookings after grace", () => {
    expect(canPerformTenantAction("BLOCKED", "operate_existing")).toBe(true);
    expect(canPerformTenantAction("BLOCKED", "refund_existing")).toBe(true);
    expect(canPerformTenantAction("BLOCKED", "create_booking")).toBe(false);
    expect(canPerformTenantAction("BLOCKED", "reschedule")).toBe(false);
  });

  it("limits canceled tenants to export and billing recovery", () => {
    expect(canPerformTenantAction("CANCELED_RETENTION", "export_data")).toBe(true);
    expect(canPerformTenantAction("CANCELED_RETENTION", "view_existing")).toBe(false);
  });
});

