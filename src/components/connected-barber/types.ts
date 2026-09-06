export type BarberAgendaScope = "OWN" | "FULL";
export type BarberCashSessionStatus = "OPEN" | "RECONCILED";

export type BarberAppContext = {
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  organization_logo_path: string | null;
  organization_logo_url?: string | null;
  timezone: string;
  barber_id: string;
  barber_name: string;
  barber_avatar_url: string | null;
  barber_bio: string | null;
  barber_whatsapp_e164: string | null;
  agenda_access_scope: BarberAgendaScope;
  cash_access_enabled: boolean;
};

export type BarberAccountProfile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  phone_e164: string | null;
  bio: string | null;
};

export type BarberAccessState = {
  user_id: string;
  email: string | null;
  profile: BarberAccountProfile;
  organizations: BarberAppContext[];
};

export type BarberAppointment = {
  id: string;
  customer_id: string;
  barber_id: string;
  status: "CONFIRMED" | "IN_SERVICE" | "COMPLETED" | "CANCELED" | "NO_SHOW" | string;
  service_period: string;
  total_cents_snapshot: number;
  payment_mode: string;
  notes: string | null;
  source?: string;
  created_at?: string;
  whatsapp_response_status?: string | null;
};

export type BarberCustomer = { id: string; full_name: string; phone_e164: string | null };
export type BarberService = { id: string; name: string; price_cents: number; duration_minutes: number };
export type BarberProfessional = { id: string; display_name: string };
export type BarberCashSession = {
  id: string;
  business_date: string;
  status: BarberCashSessionStatus;
  expected_cents: number;
  reconciled_cents: number | null;
  variance_cents: number | null;
};
export type BarberCashReceipt = {
  id: string;
  appointment_id: string;
  customer_name: string;
  amount_cents: number;
  payment_method: string;
  financial_account_name: string;
  status: "PENDING_RECONCILIATION" | "RECONCILED" | "REVERSED";
  created_at: string;
};
export type BarberFinancialAccount = { id: string; name: string; kind: "BANK" | "CASH" };
export type BarberAppointmentItem = { appointment_id: string; service_name_snapshot: string; position: number };
