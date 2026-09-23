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
  projects_access_enabled: boolean;
  barber_auth_user_id: string;
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

export type BarberCustomer = { id: string; full_name: string; phone_e164: string | null; dependents?: Array<{ id: string; full_name: string }> };
export type BarberService = { id: string; name: string; price_cents: number; duration_minutes: number };
export type BarberProfessional = { id: string; display_name: string };
export type BarberCashSession = {
  id: string;
  closure_id?: number | null;
  business_date: string;
  status: BarberCashSessionStatus;
  expected_cents: number;
  reconciled_cents: number | null;
  variance_cents: number | null;
  reconciled_at?: string | null;
  reconciled_by_name?: string | null;
};
export type BarberCashReceipt = {
  id: string;
  cash_session_id: string;
  appointment_id: string;
  financial_account_id: string;
  customer_name: string;
  amount_cents: number;
  payment_method: string;
  financial_account_name: string;
  status: "PENDING_RECONCILIATION" | "RECONCILED" | "REVERSED";
  created_at: string;
};
export type BarberFinancialAccount = { id: string; name: string; kind: "BANK" | "CASH" };
export type BarberAccountBalance = BarberFinancialAccount & { balance_cents: number };
export type BarberAppointmentItem = { appointment_id: string; service_name_snapshot: string; position: number };
export type BarberProject = { project_id: string; organization_id: string; organization_name: string; organization_slug: string; name: string; description: string | null; status: string; starts_on: string | null; ends_on: string | null };
export type BarberProjectBoard = { id: string; project_id: string; name: string; position: number; system_key: string | null };
export type BarberProjectEngagement = { id: string; project_id: string; customer_id: string; kanban_board_id: string; status: string; event_description: string | null; event_due_on: string | null; customer?: { full_name: string } | null };
export type BarberProjectLink = { id: string; engagement_id: string; label: string; url: string; created_by: string; created_at: string };
