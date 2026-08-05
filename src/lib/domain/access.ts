import type { BillingStatus, TenantAction } from "./types";

const fullAccess = new Set<TenantAction>([
  "configure_billing",
  "view_existing",
  "operate_existing",
  "cancel_existing",
  "refund_existing",
  "create_booking",
  "reschedule",
  "export_data",
]);

const blockedAccess = new Set<TenantAction>([
  "configure_billing",
  "view_existing",
  "operate_existing",
  "cancel_existing",
  "refund_existing",
  "export_data",
]);

export function canPerformTenantAction(status: BillingStatus, action: TenantAction): boolean {
  if (status === "TRIALING" || status === "ACTIVE" || status === "GRACE") {
    return fullAccess.has(action);
  }
  if (status === "BLOCKED") return blockedAccess.has(action);
  if (status === "CANCELED_RETENTION") return action === "export_data" || action === "configure_billing";
  if (status === "PROVISIONING") return action === "configure_billing";
  return false;
}

