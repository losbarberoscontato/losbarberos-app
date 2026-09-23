import { getSupabaseServerClient } from "@/lib/supabase/server";
import type {
  BarberAccessState,
  BarberAccountBalance,
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
    supabase.from("customers").select("id,full_name,phone_e164,customer_dependents(id,full_name)").eq("organization_id", context.organization_id).eq("active", true).is("merged_into_customer_id", null).order("full_name").limit(500),
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
  const [sessions, receipts, accounts, appointments, financial, closures] = await Promise.all([
    supabase.from("barber_cash_sessions").select("id,business_date,status,expected_cents,reconciled_cents,variance_cents,reconciled_at,reconciled_by_name").eq("organization_id", context.organization_id).eq("barber_id", context.barber_id).order("business_date", { ascending: false }).limit(90),
    supabase.from("barber_cash_receipts").select("id,cash_session_id,appointment_id,financial_account_id,amount_cents,payment_method,status,created_at").eq("organization_id", context.organization_id).eq("received_by_barber_id", context.barber_id).order("created_at", { ascending: false }).limit(500),
    supabase.from("financial_accounts").select("id,name,kind").eq("organization_id", context.organization_id).eq("active", true).order("name"),
    supabase.from("appointments").select("id,customer_id,barber_id,status,service_period,total_cents_snapshot,payment_mode,notes").eq("organization_id", context.organization_id).eq("status", "COMPLETED").order("service_period", { ascending: false }).limit(250),
    supabase.from("appointment_financial_summary").select("appointment_id,outstanding_cents").eq("organization_id", context.organization_id).limit(500),
    supabase.from("barber_cash_reconciliations").select("id,cash_session_id").eq("organization_id", context.organization_id).order("reconciled_at", { ascending: false }).limit(90),
  ]);
  const activeAccountRows = rows(accounts.data as BarberFinancialAccount[]);
  const receiptRowsRaw = rows(receipts.data as Array<Omit<BarberCashReceipt, "customer_name" | "financial_account_name">>);
  const appointmentRows = rows(appointments.data as BarberAppointment[]);
  const receiptAppointmentIds = [...new Set(receiptRowsRaw.map((receipt) => receipt.appointment_id))];
  const missingAppointmentIds = receiptAppointmentIds.filter((id) => !appointmentRows.some((appointment) => appointment.id === id));
  const receiptAppointmentsResult = missingAppointmentIds.length > 0
    ? await supabase.from("appointments").select("id,customer_id,barber_id,status,service_period,total_cents_snapshot,payment_mode,notes").eq("organization_id", context.organization_id).in("id", missingAppointmentIds)
    : { data: [] };
  const allAppointmentRows = [...appointmentRows, ...rows(receiptAppointmentsResult.data as BarberAppointment[])];
  const receiptAccountIds = [...new Set(receiptRowsRaw.map((receipt) => receipt.financial_account_id))];
  const historicalAccountsResult = receiptAccountIds.length > 0
    ? await supabase.from("financial_accounts").select("id,name,kind").eq("organization_id", context.organization_id).in("id", receiptAccountIds)
    : { data: [] };
  const knownAccounts = [...activeAccountRows, ...rows(historicalAccountsResult.data as BarberFinancialAccount[])].filter((account, index, list) => list.findIndex((item) => item.id === account.id) === index);
  const accountById = new Map(knownAccounts.map((account) => [account.id, account]));
  for (const accountId of receiptAccountIds) {
    if (!accountById.has(accountId)) accountById.set(accountId, { id: accountId, name: "Conta financeira histórica", kind: "BANK" });
  }
  const customerIds = [...new Set(allAppointmentRows.map((appointment) => appointment.customer_id))];
  const customersResult = customerIds.length > 0
    ? await supabase.from("customers").select("id,full_name,phone_e164").eq("organization_id", context.organization_id).in("id", customerIds)
    : { data: [] };
  const customerRows = rows(customersResult.data as BarberCustomer[]);
  const customerById = new Map(customerRows.map((item) => [item.id, item.full_name]));
  const appointmentById = new Map(allAppointmentRows.map((item) => [item.id, item]));
  const receiptRows = receiptRowsRaw.map((receipt) => ({
    ...receipt,
    customer_name: customerById.get(appointmentById.get(receipt.appointment_id)?.customer_id ?? "") ?? "Cliente",
    financial_account_name: accountById.get(receipt.financial_account_id)?.name ?? "Conta financeira",
  }));
  const openSessionIds = new Set(rows(sessions.data as BarberCashSession[]).filter((session) => session.status === "OPEN").map((session) => session.id));
  const currentReceiptRows = receiptRows.filter((receipt) => receipt.status === "PENDING_RECONCILIATION" && openSessionIds.has(receipt.cash_session_id));
  const accountBalances: BarberAccountBalance[] = [...accountById.values()].map((account) => ({
    ...account,
    balance_cents: currentReceiptRows.filter((receipt) => receipt.financial_account_id === account.id).reduce((sum, receipt) => sum + receipt.amount_cents, 0),
  }));
  const closureBySession = new Map(rows(closures.data as Array<{ id: number; cash_session_id: string }>).map((closure) => [closure.cash_session_id, closure.id]));
  const sessionRows = rows(sessions.data as BarberCashSession[]).map((session) => ({
    ...session,
    closure_id: closureBySession.get(session.id) ?? null,
  }));
  return {
    context,
    sessions: sessionRows,
    receipts: receiptRows,
    accounts: activeAccountRows,
    accountBalances,
    appointments: allAppointmentRows,
    customers: customerRows,
    outstandingByAppointment: new Map(rows(financial.data as { appointment_id: string; outstanding_cents: number }[]).map((item) => [item.appointment_id, item.outstanding_cents])),
  };
}
