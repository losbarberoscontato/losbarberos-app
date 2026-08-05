import "server-only";

import { getAccessContext } from "@/lib/auth/context";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type {
  AppointmentRecord,
  AvailabilityExceptionRecord,
  BarberRecord,
  BarberServiceRecord,
  CommissionLedgerRecord,
  CommissionPayoutRecord,
  CommissionRuleRecord,
  CustomerRecord,
  FinancialSummaryRecord,
  LocationRecord,
  MerchantAccountRecord,
  OrganizationRecord,
  OutboxRecord,
  PackageItemRecord,
  PackageRecord,
  ServiceRecord,
  SubscriptionRecord,
  RefundJobRecord,
  WorkIntervalRecord,
} from "./types";

const MANAGER_ROW_LIMIT = 1_000;

async function managerClient() {
  const [context, supabase] = await Promise.all([getAccessContext(), getSupabaseServerClient()]);
  if (!context || context.role !== "OWNER" || !context.organizationId || !supabase) {
    throw new Error("Sessão de gestor inválida.");
  }
  return { context, supabase, organizationId: context.organizationId };
}

function requireData<T>(result: { data: T | null; error: { message: string } | null }, label: string): T {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data as T;
}

export async function loadCustomersData() {
  const { context, supabase, organizationId } = await managerClient();
  const result = await supabase
    .from("customers")
    .select("id,organization_id,full_name,phone_e164,email,birth_date,notes,active,created_at")
    .eq("organization_id", organizationId)
    .is("merged_into_customer_id", null)
    .order("active", { ascending: false })
    .order("full_name")
    .limit(MANAGER_ROW_LIMIT);
  return {
    organizationId,
    billingStatus: context.billingStatus,
    customers: requireData(result, "Clientes") as CustomerRecord[],
  };
}

export async function loadCatalogData() {
  const { context, supabase, organizationId } = await managerClient();
  const [servicesResult, packagesResult, itemsResult] = await Promise.all([
    supabase.from("services").select("*").eq("organization_id", organizationId).order("sort_order").order("name"),
    supabase.from("packages").select("*").eq("organization_id", organizationId).order("sort_order").order("name"),
    supabase.from("package_items").select("*").eq("organization_id", organizationId).order("position"),
  ]);
  return {
    organizationId,
    billingStatus: context.billingStatus,
    services: requireData(servicesResult, "Serviços") as ServiceRecord[],
    packages: requireData(packagesResult, "Pacotes") as PackageRecord[],
    packageItems: requireData(itemsResult, "Itens dos pacotes") as PackageItemRecord[],
  };
}

export async function loadTeamData() {
  const { context, supabase, organizationId } = await managerClient();
  const [organization, locations, barbers, services, links, intervals, exceptions, rules] = await Promise.all([
    supabase.from("organizations").select("timezone").eq("id", organizationId).single(),
    supabase.from("locations").select("*").eq("organization_id", organizationId).order("active", { ascending: false }),
    supabase.from("barbers").select("*").eq("organization_id", organizationId).order("active", { ascending: false }).order("display_name"),
    supabase.from("services").select("*").eq("organization_id", organizationId).eq("active", true).order("name"),
    supabase.from("barber_services").select("*").eq("organization_id", organizationId),
    supabase.from("work_intervals").select("*").eq("organization_id", organizationId).order("weekday").order("starts_at"),
    supabase.from("availability_exceptions").select("*").eq("organization_id", organizationId).order("service_period"),
    supabase.from("commission_rules").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false }),
  ]);
  return {
    organizationId,
    billingStatus: context.billingStatus,
    timezone: (requireData(organization, "Organização") as { timezone: string }).timezone,
    locations: requireData(locations, "Unidade") as LocationRecord[],
    barbers: requireData(barbers, "Equipe") as BarberRecord[],
    services: requireData(services, "Serviços") as ServiceRecord[],
    barberServices: requireData(links, "Competências") as BarberServiceRecord[],
    workIntervals: requireData(intervals, "Escalas") as WorkIntervalRecord[],
    exceptions: requireData(exceptions, "Exceções") as AvailabilityExceptionRecord[],
    commissionRules: requireData(rules, "Comissões") as CommissionRuleRecord[],
  };
}

export async function loadAgendaData() {
  const { context, supabase, organizationId } = await managerClient();
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 31);
  const to = new Date(now);
  to.setDate(to.getDate() + 93);
  const [org, appointments, customers, barbers, services, packages, links, financial] = await Promise.all([
    supabase.from("organizations").select("*").eq("id", organizationId).single(),
    supabase.from("appointments").select("*").eq("organization_id", organizationId).overlaps("service_period", `[${from.toISOString()},${to.toISOString()})`).order("service_period").limit(MANAGER_ROW_LIMIT),
    supabase.from("customers").select("id,organization_id,full_name,phone_e164,email,birth_date,notes,active,created_at").eq("organization_id", organizationId).eq("active", true).is("merged_into_customer_id", null).order("full_name").limit(MANAGER_ROW_LIMIT),
    supabase.from("barbers").select("*").eq("organization_id", organizationId).eq("active", true).order("display_name"),
    supabase.from("services").select("*").eq("organization_id", organizationId).eq("active", true).order("name"),
    supabase.from("packages").select("*").eq("organization_id", organizationId).eq("active", true).order("name"),
    supabase.from("barber_services").select("*").eq("organization_id", organizationId).eq("active", true),
    supabase.from("appointment_financial_summary").select("*").eq("organization_id", organizationId).limit(MANAGER_ROW_LIMIT),
  ]);
  return {
    organizationId,
    billingStatus: context.billingStatus,
    organization: requireData(org, "Organização") as OrganizationRecord,
    appointments: requireData(appointments, "Agenda") as AppointmentRecord[],
    customers: requireData(customers, "Clientes") as CustomerRecord[],
    barbers: requireData(barbers, "Equipe") as BarberRecord[],
    services: requireData(services, "Serviços") as ServiceRecord[],
    packages: requireData(packages, "Pacotes") as PackageRecord[],
    barberServices: requireData(links, "Competências") as BarberServiceRecord[],
    financial: requireData(financial, "Financeiro") as FinancialSummaryRecord[],
  };
}

export async function loadFinanceData() {
  const { context, supabase, organizationId } = await managerClient();
  const [financial, appointments, customers, barbers, ledger, payouts, refunds, outbox] = await Promise.all([
    supabase.from("appointment_financial_summary").select("*").eq("organization_id", organizationId).limit(MANAGER_ROW_LIMIT),
    supabase.from("appointments").select("id,organization_id,customer_id,barber_id,status,source,service_period,payment_mode,currency,total_cents_snapshot,notes,schedule_override_reason,created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(250),
    supabase.from("customers").select("id,organization_id,full_name,phone_e164,email,birth_date,notes,active,created_at").eq("organization_id", organizationId).limit(MANAGER_ROW_LIMIT),
    supabase.from("barbers").select("*").eq("organization_id", organizationId).order("display_name"),
    supabase.from("commission_ledger").select("id,source_entry_id,barber_id,appointment_id,kind,amount_cents,reason,earned_at").eq("organization_id", organizationId).order("earned_at", { ascending: false }).limit(500),
    supabase.from("commission_payouts").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(200),
    supabase.from("refund_jobs").select("id,appointment_id,amount_cents,status,attempts,next_attempt_at,last_error,created_at").eq("organization_id", organizationId).in("status", ["PENDING", "PROCESSING", "FAILED", "SEND_UNKNOWN"]).order("created_at", { ascending: false }).limit(100),
    supabase.from("notification_outbox").select("id,appointment_id,template_key,recipient_e164,status,attempts,next_attempt_at,last_error,created_at").eq("organization_id", organizationId).in("status", ["FAILED", "SEND_UNKNOWN"]).order("created_at", { ascending: false }).limit(100),
  ]);
  return {
    organizationId,
    billingStatus: context.billingStatus,
    financial: requireData(financial, "Resumo financeiro") as FinancialSummaryRecord[],
    appointments: requireData(appointments, "Agendamentos") as AppointmentRecord[],
    customers: requireData(customers, "Clientes") as CustomerRecord[],
    barbers: requireData(barbers, "Equipe") as BarberRecord[],
    ledger: requireData(ledger, "Ledger de comissão") as CommissionLedgerRecord[],
    payouts: requireData(payouts, "Lotes") as CommissionPayoutRecord[],
    refundJobs: requireData(refunds, "Reembolsos pendentes") as RefundJobRecord[],
    outboxIssues: requireData(outbox, "Mensagens pendentes") as OutboxRecord[],
  };
}

export async function loadSettingsData() {
  const { context, supabase, organizationId } = await managerClient();
  const [organization, locations, merchant, subscription] = await Promise.all([
    supabase.from("organizations").select("*").eq("id", organizationId).single(),
    supabase.from("locations").select("*").eq("organization_id", organizationId).order("active", { ascending: false }),
    supabase.from("merchant_accounts").select("status,external_account_id,connected_at,token_expires_at").eq("organization_id", organizationId).eq("provider", "MERCADO_PAGO").maybeSingle(),
    supabase.from("saas_subscriptions").select("status,trial_ends_at,current_period_ends_at,grace_ends_at,retention_ends_at").eq("organization_id", organizationId).maybeSingle(),
  ]);
  return {
    organizationId,
    billingStatus: context.billingStatus,
    organization: requireData(organization, "Organização") as OrganizationRecord,
    locations: requireData(locations, "Unidade") as LocationRecord[],
    merchant: requireData(merchant, "Mercado Pago") as MerchantAccountRecord | null,
    subscription: requireData(subscription, "Assinatura") as SubscriptionRecord | null,
  };
}

export async function loadDashboardData() {
  const { context, supabase, organizationId } = await managerClient();
  const from = new Date(Date.now() - 31 * 86_400_000).toISOString();
  const to = new Date(Date.now() + 93 * 86_400_000).toISOString();
  const [organization, appointments, customers, barbers, financial, payouts] = await Promise.all([
    supabase.from("organizations").select("*").eq("id", organizationId).single(),
    supabase.from("appointments").select("*").eq("organization_id", organizationId).overlaps("service_period", `[${from},${to})`).order("service_period").limit(500),
    supabase.from("customers").select("id,organization_id,full_name,phone_e164,email,birth_date,notes,active,created_at").eq("organization_id", organizationId).limit(MANAGER_ROW_LIMIT),
    supabase.from("barbers").select("*").eq("organization_id", organizationId).eq("active", true).order("display_name"),
    supabase.from("appointment_financial_summary").select("*").eq("organization_id", organizationId).limit(MANAGER_ROW_LIMIT),
    supabase.from("commission_payouts").select("*").eq("organization_id", organizationId).eq("status", "OPEN"),
  ]);
  return {
    organizationId,
    billingStatus: context.billingStatus,
    organization: requireData(organization, "Organização") as OrganizationRecord,
    appointments: requireData(appointments, "Agenda") as AppointmentRecord[],
    customers: requireData(customers, "Clientes") as CustomerRecord[],
    barbers: requireData(barbers, "Equipe") as BarberRecord[],
    financial: requireData(financial, "Financeiro") as FinancialSummaryRecord[],
    openPayouts: requireData(payouts, "Comissões") as CommissionPayoutRecord[],
  };
}
