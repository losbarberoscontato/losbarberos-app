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

export type AppointmentWhatsAppResponseStatus =
  | "PENDING"
  | "CONFIRMED_BY_WHATSAPP"
  | "CANCELED_BY_WHATSAPP"
  | "RESCHEDULE_REQUESTED_BY_WHATSAPP"
  | "CONTACT_REQUESTED_BY_WHATSAPP"
  | "CONFIRMED_MANUALLY";

export interface ManagerScope {
  organizationId: string;
  billingStatus: BillingStatus | null;
}

export interface OrganizationRecord {
  queue_public_id?: string | null;
  booking_public_id?: string | null;
  public_contact_phone_e164?: string | null;
  logo_path?: string | null;
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
  auth_user_id: string | null;
  full_name: string;
  phone_e164: string | null;
  email: string | null;
  birth_date: string | null;
  notes: string | null;
  active: boolean;
  inactivation_reason: string | null;
  inactivated_at: string | null;
  created_at: string;
  whatsapp_transactional_opted_out?: boolean;
}

export interface BarberRecord {
  id: string;
  organization_id: string;
  location_id: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  whatsapp_e164: string | null;
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
  audiences: readonly import("@/lib/catalog-audiences").CatalogAudience[];
}

export interface PackageRecord {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  price_cents: number;
  active: boolean;
  sort_order: number;
  audiences: readonly import("@/lib/catalog-audiences").CatalogAudience[];
}

export interface PackageItemRecord {
  id: string;
  organization_id: string;
  package_id: string;
  service_id: string;
  quantity: number;
  position: number;
  active: boolean;
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
  whatsapp_response_status?: AppointmentWhatsAppResponseStatus | null;
  source: string;
  service_period: string;
  payment_mode: string;
  currency: string;
  total_cents_snapshot: number;
  notes: string | null;
  schedule_override_reason: string | null;
  created_at: string;
}

export interface AppointmentItemRecord {
  id: string;
  organization_id: string;
  appointment_id: string;
  service_name_snapshot: string;
  position: number;
}

export interface FinancialSummaryRecord {
  appointment_id: string;
  captured_cents: number;
  refunded_cents: number;
  net_paid_cents: number;
  outstanding_cents: number;
  financial_status: string;
}

export interface AppointmentStatusEventRecord {
  id: number;
  organization_id: string;
  appointment_id: string;
  reason: string | null;
  created_at: string;
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

export type FinanceSection = "overview" | "cash" | "payables" | "receivables" | "accounts" | "suppliers" | "catalogs" | "reports";

export type FinancialFactBasis = "FORECAST" | "ACCRUAL" | "CASH" | "BUDGET";
export type FinancialReportType = "DASHBOARD" | "PAYABLES" | "RECEIVABLES" | "CUSTOMERS" | "COMMISSIONS" | "FORECAST" | "CASH_FLOW" | "INCOME_STATEMENT" | "BUDGET";

export interface FinancialReportingFactRecord {
  organization_id: string;
  basis: FinancialFactBasis;
  source_type: string;
  source_id: string;
  fact_date: string;
  competence_date: string | null;
  due_date: string | null;
  settlement_date: string | null;
  location_id: string | null;
  customer_id: string | null;
  barber_id: string | null;
  service_id: string | null;
  service_name_snapshot: string | null;
  chart_account_id: string | null;
  cost_center_id: string | null;
  financial_account_id: string | null;
  dre_group: "GROSS_REVENUE" | "REVENUE_DEDUCTIONS" | "SERVICE_COST" | "OPERATING_EXPENSE" | "FINANCIAL_RESULT" | "OTHER_RESULT" | "INCOME_TAX" | null;
  cash_flow_activity: "OPERATING" | "INVESTING" | "FINANCING" | null;
  signed_cents: number;
  status: string;
}

export interface FinancialBudgetVersionRecord {
  id: string;
  organization_id: string;
  budget_id: string;
  version_number: number;
  status: "DRAFT" | "APPROVED" | "SUPERSEDED";
  approved_at: string | null;
}

export interface FinancialAccountRecord {
  id: string;
  organization_id: string;
  kind: "BANK" | "CASH";
  name: string;
  bank_code: string | null;
  branch: string | null;
  account_number: string | null;
  description: string | null;
  opening_balance_cents: number;
  active: boolean;
}

export interface FinancialAccountBalanceRecord {
  financial_account_id: string;
  balance_cents: number;
}

export interface SupplierRecord {
  id: string;
  organization_id: string;
  person_kind: "INDIVIDUAL" | "COMPANY";
  name: string;
  document: string | null;
  phone_e164: string | null;
  email: string | null;
  address: Record<string, unknown>;
  notes: string | null;
  active: boolean;
}

export interface ChartAccountRecord {
  id: string;
  organization_id: string;
  parent_id: string | null;
  code: string | null;
  name: string;
  kind: "REVENUE" | "EXPENSE";
  dre_group?: "GROSS_REVENUE" | "REVENUE_DEDUCTIONS" | "SERVICE_COST" | "OPERATING_EXPENSE" | "FINANCIAL_RESULT" | "OTHER_RESULT" | "INCOME_TAX" | null;
  cash_flow_activity?: "OPERATING" | "INVESTING" | "FINANCING" | null;
  active: boolean;
}

export interface CostCenterRecord {
  id: string;
  organization_id: string;
  name: string;
  active: boolean;
}

export interface FinancialTagRecord {
  id: string;
  organization_id: string;
  name: string;
  color: string | null;
  active: boolean;
}

export interface FinancialEntryRecord {
  id: string;
  organization_id: string;
  kind: "REVENUE" | "EXPENSE";
  description: string;
  issue_date: string;
  due_date: string;
  total_cents: number;
  settled_cents: number;
  remaining_cents: number;
  status: "OPEN" | "PARTIAL" | "SETTLED" | "OVERDUE" | "CANCELED";
  chart_account_id: string;
  cost_center_id: string | null;
  preferred_financial_account_id: string | null;
  counterparty_kind: "CUSTOMER" | "SUPPLIER" | null;
  customer_id: string | null;
  supplier_id: string | null;
  document_number: string | null;
  canceled_at: string | null;
  cancellation_reason: string | null;
}

export interface FinancialEntryTagRecord {
  entry_id: string;
  tag_id: string;
}

export interface FinancialSettlementRecord {
  id: string;
  entry_id: string;
  financial_account_id: string;
  kind: "SETTLEMENT" | "REVERSAL";
  amount_cents: number;
  settled_on: string;
  payment_method: string;
  reference: string | null;
}

export interface AppointmentCashActivityRecord {
  payment_transaction_id: string;
  organization_id: string;
  appointment_id: string;
  customer_id: string;
  payment_mode: string;
  provider: "MERCADO_PAGO" | "MANUAL";
  kind: "CAPTURE" | "REFUND" | "REVERSAL" | "ADJUSTMENT";
  amount_cents: number;
  signed_cents: number;
  occurred_at: string;
  financial_account_id: string | null;
  needs_reconciliation: boolean;
  display_description: string;
  financial_status: string;
}

export interface AppointmentReceivableRecord {
  appointment_id: string;
  organization_id: string;
  customer_id: string;
  customer_name: string;
  description: string;
  amount_cents: number;
  issue_date: string;
  due_date: string;
  document_number: string;
  outstanding_cents: number;
}

export interface PaymentAccountMappingRecord {
  id: string;
  organization_id: string;
  provider: "MERCADO_PAGO" | "MANUAL";
  payment_mode: "DEPOSIT" | "FULL" | "COUNTER";
  financial_account_id: string;
}
