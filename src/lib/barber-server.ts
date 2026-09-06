import { getSupabaseServerClient } from "@/lib/supabase/server";
import type {
  BarberAccessState,
  BarberAccountProfile,
  BarberAppContext,
  BarberAppointment,
  BarberAppointmentItem,
  BarberCashReceipt,
  BarberCashSession,
  BarberCustomer,
  BarberFinancialAccount,
  BarberProfessional,
  BarberService,
} from "@/components/connected-barber/types";
import { normalizeTenantSlug } from "@/components/connected-client/format";

function rows<T>(value: T[] | null | undefined): T[] {
  return value ?? [];
}

async function listBarberContexts(slug?: string | null): Promise<BarberAppContext[]> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("get_my_barber_app_context", {
    p_organization_slug: slug ?? null,
  });
  if (error) return [];
  return rows(data as BarberAppContext[]).map((context) => ({
    ...context,
    organization_logo_url: context.organization_logo_path
      ? supabase.storage.from("organization-logos").getPublicUrl(context.organization_logo_path).data.publicUrl
      : null,
  }));
}

export async function getBarberAppContext(slug?: string | null): Promise<BarberAppContext | null> {
  const normalizedSlug = normalizeTenantSlug(slug);
  if (!normalizedSlug) return null;
  const contexts = await listBarberContexts(normalizedSlug);
  return contexts[0] ?? null;
}

export async function listMyBarberOrganizations(): Promise<BarberAppContext[]> {
  return listBarberContexts();
}

export async function getBarberAccessState(): Promise<BarberAccessState | null> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return null;
  const { data: authData, error: authError } = await supabase.auth.getUser();
  const user = authData.user;
  if (authError || !user) return null;
  const [organizations, profileResult] = await Promise.all([
    listBarberContexts(),
    supabase.from("profiles").select("id,display_name,avatar_url,phone_e164,bio").eq("id", user.id).maybeSingle(),
  ]);
  const profile: BarberAccountProfile = profileResult.data ?? {
    id: user.id,
    display_name: null,
    avatar_url: null,
    phone_e164: null,
    bio: null,
  };
  return { user_id: user.id, email: user.email ?? null, profile, organizations };
}

export async function loadBarberAgenda(slug?: string | null) {
  const context = await getBarberAppContext(slug);
  const supabase = await getSupabaseServerClient();
  if (!context || !supabase) return null;
  const now = new Date();
  const from = new Date(now); from.setDate(from.getDate() - 7);
  const to = new Date(now); to.setDate(to.getDate() + 31);
  const [appointments, appointmentItems, customers, services, professionals, financial, accounts] = await Promise.all([
    supabase.from("appointments").select("id,customer_id,barber_id,status,service_period,total_cents_snapshot,payment_mode,notes,source,created_at,whatsapp_response_status").eq("organization_id", context.organization_id).overlaps("service_period", `[${from.toISOString()},${to.toISOString()})`).order("service_period").limit(500),
    supabase.from("appointment_items").select("appointment_id,service_name_snapshot,position").eq("organization_id", context.organization_id).limit(1500),
    supabase.from("customers").select("id,full_name,phone_e164").eq("organization_id", context.organization_id).eq("active", true).is("merged_into_customer_id", null).order("full_name").limit(500),
    supabase.from("services").select("id,name,price_cents,duration_minutes").eq("organization_id", context.organization_id).eq("active", true).order("name"),
    supabase.from("barbers").select("id,display_name").eq("organization_id", context.organization_id).eq("active", true).order("display_name"),
    supabase.from("appointment_financial_summary").select("appointment_id,outstanding_cents").eq("organization_id", context.organization_id).limit(500),
    context.cash_access_enabled
      ? supabase.from("financial_accounts").select("id,name,kind").eq("organization_id", context.organization_id).eq("active", true).order("name")
      : Promise.resolve({ data: [] }),
  ]);
  return {
    context,
    appointments: rows(appointments.data as BarberAppointment[]),
    appointmentItems: rows(appointmentItems.data as BarberAppointmentItem[]),
    customers: rows(customers.data as BarberCustomer[]),
    services: rows(services.data as BarberService[]),
    professionals: rows(professionals.data as BarberProfessional[]),
    outstandingByAppointment: new Map(rows(financial.data as { appointment_id: string; outstanding_cents: number }[]).map((item) => [item.appointment_id, item.outstanding_cents])),
    accounts: rows(accounts.data as BarberFinancialAccount[]),
  };
}

export async function loadBarberCash(slug?: string | null) {
  const context = await getBarberAppContext(slug);
  const supabase = await getSupabaseServerClient();
  if (!context || !context.cash_access_enabled || !supabase) return null;
  const [sessions, receipts, accounts, appointments, customers, financial] = await Promise.all([
    supabase.from("barber_cash_sessions").select("id,business_date,status,expected_cents,reconciled_cents,variance_cents").eq("organization_id", context.organization_id).eq("barber_id", context.barber_id).order("business_date", { ascending: false }).limit(90),
    supabase.from("barber_cash_receipt_view").select("id,appointment_id,customer_name,amount_cents,payment_method,financial_account_name,status,created_at").eq("organization_id", context.organization_id).eq("received_by_barber_id", context.barber_id).order("created_at", { ascending: false }).limit(500),
    supabase.from("financial_accounts").select("id,name,kind").eq("organization_id", context.organization_id).eq("active", true).order("name"),
    supabase.from("appointments").select("id,customer_id,barber_id,status,service_period,total_cents_snapshot,payment_mode,notes").eq("organization_id", context.organization_id).eq("status", "COMPLETED").order("service_period", { ascending: false }).limit(250),
    supabase.from("customers").select("id,full_name,phone_e164").eq("organization_id", context.organization_id).eq("active", true).limit(500),
    supabase.from("appointment_financial_summary").select("appointment_id,outstanding_cents").eq("organization_id", context.organization_id).limit(500),
  ]);
  return {
    context,
    sessions: rows(sessions.data as BarberCashSession[]),
    receipts: rows(receipts.data as BarberCashReceipt[]),
    accounts: rows(accounts.data as BarberFinancialAccount[]),
    appointments: rows(appointments.data as BarberAppointment[]),
    customers: rows(customers.data as BarberCustomer[]),
    outstandingByAppointment: new Map(rows(financial.data as { appointment_id: string; outstanding_cents: number }[]).map((item) => [item.appointment_id, item.outstanding_cents])),
  };
}
