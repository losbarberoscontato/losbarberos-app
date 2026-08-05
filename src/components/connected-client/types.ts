import type { User } from "@supabase/supabase-js";
import type { CatalogAudience } from "@/lib/catalog-audiences";

export type PublicOrganization = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  deposit_bps: number;
  cancellation_lead_minutes: number;
  accepting_bookings: boolean;
};

export type PublicLocation = {
  id: string;
  name: string;
  address: Record<string, unknown>;
};

export type PublicService = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  duration_minutes: number;
  audiences: readonly CatalogAudience[];
};

export type PublicPackageItem = {
  service_id: string;
  name: string;
  quantity: number;
  duration_minutes: number;
};

export type PublicPackage = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  audiences: readonly CatalogAudience[];
  items: PublicPackageItem[];
};

export type PublicBarber = {
  id: string;
  name: string;
  bio: string | null;
  avatar_url: string | null;
  service_ids?: string[];
};

export type PublicBookingContext = {
  organization: PublicOrganization;
  location: PublicLocation | null;
  services: PublicService[];
  packages: PublicPackage[];
  barbers: PublicBarber[];
};

export type Customer = {
  id: string;
  organization_id: string;
  auth_user_id: string;
  full_name: string;
  phone_e164: string | null;
  email: string | null;
  birth_date: string | null;
  created_at?: string;
};

export type CatalogChoice = {
  id: string;
  kind: "SERVICE" | "PACKAGE";
  name: string;
  description: string | null;
  priceCents: number;
  durationMinutes: number;
  audiences: readonly CatalogAudience[];
};

export type BookingSelection =
  | { service_id: string; quantity: number }
  | { package_id: string; quantity: number };

export type AvailableSlot = {
  starts_at: string;
  ends_at: string;
};

export type Availability = {
  duration_minutes: number | null;
  occupied_minutes?: number | null;
  total_cents: number | null;
  slots: AvailableSlot[];
};

export type AppointmentStatus =
  | "HELD"
  | "PENDING_PAYMENT"
  | "CONFIRMED"
  | "IN_SERVICE"
  | "COMPLETED"
  | "CANCELED"
  | "NO_SHOW"
  | "EXPIRED";

export type FinancialStatus =
  | "UNPAID"
  | "PARTIAL"
  | "PAID"
  | "REFUND_PENDING"
  | "PARTIALLY_REFUNDED"
  | "REFUNDED";

export type AppointmentItem = {
  id: string;
  appointment_id: string;
  selection_key: string;
  source: "SERVICE" | "PACKAGE";
  service_id: string;
  package_id: string | null;
  service_name_snapshot: string;
  quantity: number;
  charged_price_cents_snapshot: number;
  list_price_cents_snapshot: number;
  duration_minutes_snapshot: number;
  position: number;
};

export type CustomerAppointment = {
  id: string;
  organization_id: string;
  customer_id: string;
  barber_id: string;
  status: AppointmentStatus;
  service_period: string;
  payment_mode: "DEPOSIT" | "FULL" | "COUNTER";
  currency: string;
  total_cents_snapshot: number;
  deposit_required_cents_snapshot: number;
  cancellation_lead_minutes_snapshot: number;
  created_at: string;
  pending_payment_order_id: string | null;
  items: AppointmentItem[];
  financial: {
    captured_cents: number;
    refunded_cents: number;
    net_paid_cents: number;
    outstanding_cents: number;
    financial_status: FinancialStatus;
  };
};

export type PrivacyRequest = {
  id: string;
  kind: "ACCESS" | "EXPORT" | "CORRECTION" | "ANONYMIZATION" | "DELETION";
  status: "OPEN" | "IN_PROGRESS" | "COMPLETED" | "REJECTED";
  requested_at: string;
  due_at: string | null;
};

export type ConnectedClientState = {
  slug: string | null;
  context: PublicBookingContext | null;
  user: User | null;
  customer: Customer | null;
  loading: boolean;
  authLoading: boolean;
  error: string | null;
};
