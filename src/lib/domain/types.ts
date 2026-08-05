export const APPOINTMENT_STATUSES = [
  "HELD",
  "PENDING_PAYMENT",
  "CONFIRMED",
  "IN_SERVICE",
  "COMPLETED",
  "CANCELED",
  "NO_SHOW",
  "EXPIRED",
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const BILLING_STATUSES = [
  "PROVISIONING",
  "TRIALING",
  "ACTIVE",
  "GRACE",
  "BLOCKED",
  "CANCELED_RETENTION",
  "CLOSED",
] as const;

export type BillingStatus = (typeof BILLING_STATUSES)[number];

export type FinancialStatus =
  | "UNPAID"
  | "PARTIAL"
  | "PAID"
  | "REFUND_PENDING"
  | "PARTIALLY_REFUNDED"
  | "REFUNDED";

export type TenantAction =
  | "configure_billing"
  | "view_existing"
  | "operate_existing"
  | "cancel_existing"
  | "refund_existing"
  | "create_booking"
  | "reschedule"
  | "export_data";

export type PaymentMode = "DEPOSIT" | "FULL" | "COUNTER";

export interface BookingItemInput {
  id: string;
  name: string;
  quantity: number;
  durationMinutes: number;
  listPriceCents: number;
  salePriceCents: number;
}

export interface RescheduledBookingItem extends BookingItemInput {
  pricingSource: "ORIGINAL_SNAPSHOT" | "CURRENT_CATALOG";
}

export interface BookingQuote {
  itemCount: number;
  serviceDurationMinutes: number;
  occupiedDurationMinutes: number;
  listTotalCents: number;
  totalCents: number;
  depositCents: number;
  requiredNowCents: number;
  paymentMode: PaymentMode;
}

export interface TimeInterval {
  start: Date;
  end: Date;
}

export interface CommissionRule {
  type: "FIXED_PER_ITEM" | "PERCENTAGE";
  fixedCents?: number;
  rateBps?: number;
}
