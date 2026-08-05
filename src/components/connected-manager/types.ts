export type BillingStatus =
  | "PROVISIONING"
  | "TRIALING"
  | "ACTIVE"
  | "GRACE"
  | "BLOCKED"
  | "CANCELED_RETENTION"
  | "CLOSED";

export type AppointmentStatus =
  | "HELD"
  | "PENDING_PAYMENT"
  | "CONFIRMED"
  | "IN_SERVICE"
  | "COMPLETED"
  | "CANCELED"
  | "NO_SHOW"
  | "EXPIRED";

export interface ManagerScope {
  organizationId: string;
  billingStatus: BillingStatus | null;
}

export interface OrganizationRecord {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  deposit_bps: number;
  cancellation_lead_minutes: number;
  slot_interval_minutes: number;
  hold_duration_minutes: number;
  commission_frequency: "DAILY" | "WEEKLY" | "MONTHLY";
  whatsapp_phone_number_id: string | null;
}

export interface LocationRecord {
  id: string;
  organization_id: string;
  name: string;
  address: Record<string, unknown>;
  active: boolean;
}

export interface CustomerRecord {
  id: string;
  organization_id: string;
  full_name: string;
  phone_e164: string | null;
  email: string | null;
  birth_date: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
}

export interface BarberRecord {
  id: string;
  organization_id: string;
  location_id: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  active: boolean;
}

export interface ServiceRecord {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  price_cents: number;
  duration_minutes: number;
  active: boolean;
  sort_order: number;
}

export interface PackageRecord {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  price_cents: number;
  active: boolean;
  sort_order: number;
}

export interface PackageItemRecord {
  id: string;
  organization_id: string;
  package_id: string;
  service_id: string;
  quantity: number;
  position: number;
}

export interface BarberServiceRecord {
  organization_id: string;
  barber_id: string;
  service_id: string;
  active: boolean;
}

export interface WorkIntervalRecord {
  id: string;
  organization_id: string;
  barber_id: string;
  weekday: number;
  starts_at: string;
  ends_at: string;
  active: boolean;
}

export interface AvailabilityExceptionRecord {
  id: string;
  organization_id: string;
  barber_id: string;
  kind: "UNAVAILABLE" | "AVAILABLE_OVERRIDE";
  service_period: string;
  reason: string | null;
}

export interface CommissionRuleRecord {
  id: string;
  organization_id: string;
  barber_id: string | null;
  service_id: string | null;
  mode: "PERCENT" | "FIXED";
  percentage_bps: number | null;
  fixed_cents: number | null;
  effective_period: string;
  active: boolean;
}

export interface AppointmentRecord {
  id: string;
  organization_id: string;
  customer_id: string;
  barber_id: string;
  status: AppointmentStatus;
  source: string;
  service_period: string;
  payment_mode: string;
  currency: string;
  total_cents_snapshot: number;
  notes: string | null;
  schedule_override_reason: string | null;
  created_at: string;
}

export interface FinancialSummaryRecord {
  appointment_id: string;
  captured_cents: number;
  refunded_cents: number;
  net_paid_cents: number;
  outstanding_cents: number;
  financial_status: string;
}

export interface CommissionLedgerRecord {
  id: string;
  source_entry_id: string | null;
  barber_id: string;
  appointment_id: string;
  kind: "EARNED" | "REVERSAL" | "ADJUSTMENT";
  amount_cents: number;
  reason: string | null;
  earned_at: string;
}

export interface CommissionPayoutRecord {
  id: string;
  barber_id: string;
  period_start: string;
  period_end: string;
  amount_cents: number;
  status: "OPEN" | "PAID" | "CANCELED";
  paid_at: string | null;
  created_at: string;
}

export interface MerchantAccountRecord {
  status: "PENDING" | "CONNECTED" | "REAUTH_REQUIRED" | "DISCONNECTED";
  external_account_id: string | null;
  connected_at: string | null;
  token_expires_at: string | null;
}

export interface RefundJobRecord {
  id: string;
  appointment_id: string;
  amount_cents: number;
  status: "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "SEND_UNKNOWN" | "CANCELED";
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  created_at: string;
}

export interface OutboxRecord {
  id: string;
  appointment_id: string | null;
  template_key: string;
  recipient_e164: string;
  status: "PENDING" | "PROCESSING" | "SENDING" | "SENT" | "SEND_UNKNOWN" | "FAILED" | "CANCELED";
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  created_at: string;
}

export interface SubscriptionRecord {
  status: BillingStatus;
  trial_ends_at: string | null;
  current_period_ends_at: string | null;
  grace_ends_at: string | null;
  retention_ends_at: string | null;
}
