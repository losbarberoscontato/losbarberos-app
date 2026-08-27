import "server-only";

import { getAccessContext } from "@/lib/auth/context";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type {
  AppointmentRecord,
  AppointmentItemRecord,
  AppointmentStatusEventRecord,
  AvailabilityExceptionRecord,
  BarberRecord,
  BarberServiceRecord,
  CommissionLedgerRecord,
  CommissionPayoutRecord,
  CommissionRuleRecord,
  CustomerRecord,
  FinancialSummaryRecord,
  FinancialAccountBalanceRecord,
  FinancialAccountRecord,
  FinancialEntryRecord,
  FinancialEntryTagRecord,
  FinancialSettlementRecord,
  FinancialTagRecord,
  LocationRecord,
  MerchantAccountRecord,
  OrganizationRecord,
  OutboxRecord,
  PackageItemRecord,
  PackageRecord,
  ServiceRecord,
  SubscriptionRecord,
  RefundJobRecord,
  SupplierRecord,
  ChartAccountRecord,
  CostCenterRecord,
  AppointmentCashActivityRecord,
  AppointmentReceivableRecord,
  PaymentAccountMappingRecord,
  FinancialBudgetVersionRecord,
  FinancialReportingFactRecord,
  WorkIntervalRecord,
} from "./types";
import type { WhatsAppSettingsStatus } from "./whatsapp-settings";

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
  const [result, appointments, appointmentItems, financial, barbers, statusEvents, consents] = await Promise.all([
    supabase.from("customers").select("id,organization_id,auth_user_id,full_name,phone_e164,email,birth_date,notes,active,inactivation_reason,inactivated_at,created_at").eq("organization_id", organizationId).is("merged_into_customer_id", null).order("active", { ascending: false }).order("full_name").limit(MANAGER_ROW_LIMIT),
    supabase.from("appointments").select("id,organization_id,customer_id,barber_id,status,source,service_period,payment_mode,currency,total_cents_snapshot,notes,schedule_override_reason,created_at").eq("organization_id", organizationId).order("service_period", { ascending: false }).limit(MANAGER_ROW_LIMIT),
    supabase.from("appointment_items").select("id,organization_id,appointment_id,service_name_snapshot,position").eq("organization_id", organizationId).order("position").limit(MANAGER_ROW_LIMIT),
    supabase.from("appointment_financial_summary").select("appointment_id,captured_cents,refunded_cents,net_paid_cents,outstanding_cents,financial_status").eq("organization_id", organizationId).limit(MANAGER_ROW_LIMIT),
    supabase.from("barbers").select("id,organization_id,location_id,display_name,bio,avatar_url,whatsapp_e164,active").eq("organization_id", organizationId).limit(MANAGER_ROW_LIMIT),
    supabase.from("appointment_status_events").select("id,organization_id,appointment_id,reason,created_at").eq("organization_id", organizationId).eq("reason", "appointment_rescheduled").limit(MANAGER_ROW_LIMIT),
    supabase.from("consent_events").select("customer_id,action,occurred_at").eq("organization_id", organizationId).eq("kind", "WHATSAPP_TRANSACTIONAL").order("occurred_at", { ascending: false }).limit(MANAGER_ROW_LIMIT * 10),
  ]);
  const latestConsentByCustomer = new Map<string, "GRANTED" | "REVOKED">();
  for (const event of requireData(consents, "Consentimentos WhatsApp") as { customer_id: string; action: "GRANTED" | "REVOKED" }[]) {
    if (!latestConsentByCustomer.has(event.customer_id)) latestConsentByCustomer.set(event.customer_id, event.action);
  }
  const customerRows = requireData(result, "Clientes") as CustomerRecord[];
  return {
    organizationId,
    billingStatus: context.billingStatus,
    customers: customerRows.map((customer) => ({ ...customer, whatsapp_transactional_opted_out: latestConsentByCustomer.get(customer.id) === "REVOKED" })) as CustomerRecord[],
    appointments: requireData(appointments, "Agendamentos") as AppointmentRecord[],
    appointmentItems: requireData(appointmentItems, "Itens da agenda") as AppointmentItemRecord[],
    financial: requireData(financial, "Financeiro") as FinancialSummaryRecord[],
    barbers: requireData(barbers, "Equipe") as BarberRecord[],
    statusEvents: requireData(statusEvents, "Histórico de reagendamentos") as AppointmentStatusEventRecord[],
  };
}

export async function loadCatalogData() {
  const { context, supabase, organizationId } = await managerClient();
  const [servicesResult, packagesResult, itemsResult] = await Promise.all([
    supabase.from("services").select("*").eq("organization_id", organizationId).order("sort_order").order("name"),
    supabase.from("packages").select("*").eq("organization_id", organizationId).order("sort_order").order("name"),
    supabase.from("package_items").select("*").eq("organization_id", organizationId).eq("active", true).order("position"),
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
  const [org, appointments, appointmentItems, customers, barbers, services, packages, links, financial] = await Promise.all([
    supabase.from("organizations").select("*").eq("id", organizationId).single(),
    supabase.from("appointments").select("*").eq("organization_id", organizationId).overlaps("service_period", `[${from.toISOString()},${to.toISOString()})`).order("service_period").limit(MANAGER_ROW_LIMIT),
    supabase.from("appointment_items").select("id,organization_id,appointment_id,service_name_snapshot,position").eq("organization_id", organizationId).order("position").limit(MANAGER_ROW_LIMIT),
    supabase.from("customers").select("id,organization_id,auth_user_id,full_name,phone_e164,email,birth_date,notes,active,inactivation_reason,inactivated_at,created_at").eq("organization_id", organizationId).eq("active", true).is("merged_into_customer_id", null).order("full_name").limit(MANAGER_ROW_LIMIT),
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
    appointmentItems: requireData(appointmentItems, "Itens da agenda") as AppointmentItemRecord[],
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
  const [financial, appointments, customers, barbers, ledger, payouts, refunds, outbox, accounts] = await Promise.all([
    supabase.from("appointment_financial_summary").select("*").eq("organization_id", organizationId).limit(MANAGER_ROW_LIMIT),
    supabase.from("appointments").select("id,organization_id,customer_id,barber_id,status,source,service_period,payment_mode,currency,total_cents_snapshot,notes,schedule_override_reason,created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(250),
    supabase.from("customers").select("id,organization_id,auth_user_id,full_name,phone_e164,email,birth_date,notes,active,inactivation_reason,inactivated_at,created_at").eq("organization_id", organizationId).limit(MANAGER_ROW_LIMIT),
    supabase.from("barbers").select("*").eq("organization_id", organizationId).order("display_name"),
    supabase.from("commission_ledger").select("id,source_entry_id,barber_id,appointment_id,kind,amount_cents,reason,earned_at").eq("organization_id", organizationId).order("earned_at", { ascending: false }).limit(500),
    supabase.from("commission_payouts").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(200),
    supabase.from("refund_jobs").select("id,appointment_id,amount_cents,status,attempts,next_attempt_at,last_error,created_at").eq("organization_id", organizationId).in("status", ["PENDING", "PROCESSING", "FAILED", "SEND_UNKNOWN"]).order("created_at", { ascending: false }).limit(100),
    supabase.from("notification_outbox").select("id,appointment_id,template_key,recipient_e164,status,attempts,next_attempt_at,last_error,created_at").eq("organization_id", organizationId).in("status", ["FAILED", "SEND_UNKNOWN"]).order("created_at", { ascending: false }).limit(100),
    supabase.from("financial_accounts").select("id,organization_id,kind,name,bank_code,branch,account_number,description,opening_balance_cents,active").eq("organization_id", organizationId).eq("active", true).order("name"),
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
    financialAccounts: requireData(accounts, "Contas para comissão") as FinancialAccountRecord[],
  };
}

export async function loadCashData() {
  const { context, supabase, organizationId } = await managerClient();
  const [accounts, balances, suppliers, chartAccounts, costCenters, tags, customers, entries, entryTags, settlements, appointmentActivity, mappings, appointmentFinancial, appointments, appointmentItems, barbers, statusEvents] = await Promise.all([
    supabase.from("financial_accounts").select("id,organization_id,kind,name,bank_code,branch,account_number,description,opening_balance_cents,active").eq("organization_id", organizationId).order("active", { ascending: false }).order("name"),
    supabase.from("financial_account_balances").select("financial_account_id,balance_cents").eq("organization_id", organizationId),
    supabase.from("suppliers").select("id,organization_id,person_kind,name,document,phone_e164,email,address,notes,active").eq("organization_id", organizationId).order("active", { ascending: false }).order("name"),
    supabase.from("chart_of_accounts").select("id,organization_id,parent_id,code,name,kind,active,dre_group,cash_flow_activity").eq("organization_id", organizationId).order("kind").order("code").order("name"),
    supabase.from("cost_centers").select("id,organization_id,name,active").eq("organization_id", organizationId).order("active", { ascending: false }).order("name"),
    supabase.from("financial_tags").select("id,organization_id,name,color,active").eq("organization_id", organizationId).order("active", { ascending: false }).order("name"),
    supabase.from("customers").select("id,organization_id,full_name,active").eq("organization_id", organizationId).is("merged_into_customer_id", null).order("full_name").limit(MANAGER_ROW_LIMIT),
    supabase.from("financial_entry_summary").select("id,organization_id,kind,description,issue_date,due_date,total_cents,settled_cents,remaining_cents,status,chart_account_id,cost_center_id,preferred_financial_account_id,counterparty_kind,customer_id,supplier_id,document_number,canceled_at,cancellation_reason").eq("organization_id", organizationId).order("due_date", { ascending: false }).limit(MANAGER_ROW_LIMIT),
    supabase.from("financial_entry_tags").select("entry_id,tag_id").eq("organization_id", organizationId).limit(MANAGER_ROW_LIMIT),
    supabase.from("financial_settlements").select("id,entry_id,financial_account_id,kind,amount_cents,settled_on,payment_method,reference").eq("organization_id", organizationId).order("settled_on", { ascending: false }).limit(MANAGER_ROW_LIMIT),
    supabase.from("appointment_cash_activity").select("payment_transaction_id,organization_id,appointment_id,customer_id,payment_mode,provider,kind,amount_cents,signed_cents,occurred_at,financial_account_id,needs_reconciliation").eq("organization_id", organizationId).order("occurred_at", { ascending: false }).limit(MANAGER_ROW_LIMIT),
    supabase.from("payment_account_mappings").select("id,organization_id,provider,payment_mode,financial_account_id").eq("organization_id", organizationId),
    supabase.from("appointment_financial_summary").select("appointment_id,captured_cents,refunded_cents,net_paid_cents,outstanding_cents,financial_status").eq("organization_id", organizationId).limit(MANAGER_ROW_LIMIT),
    supabase.from("appointments").select("id,organization_id,customer_id,barber_id,status,payment_mode,total_cents_snapshot,created_at").eq("organization_id", organizationId).limit(MANAGER_ROW_LIMIT),
    supabase.from("appointment_items").select("appointment_id,service_name_snapshot,position").eq("organization_id", organizationId).order("position").limit(MANAGER_ROW_LIMIT),
    supabase.from("barbers").select("id,display_name").eq("organization_id", organizationId).limit(MANAGER_ROW_LIMIT),
    supabase.from("appointment_status_events").select("appointment_id,to_status,created_at").eq("organization_id", organizationId).eq("to_status", "COMPLETED").order("created_at", { ascending: false }).limit(MANAGER_ROW_LIMIT),
  ]);
  const activityRows = requireData(appointmentActivity, "Recebimentos de agendamento") as AppointmentCashActivityRecord[];
  const financialRows = requireData(appointmentFinancial, "Resumo de pagamentos") as Array<{ appointment_id: string; captured_cents: number; refunded_cents: number; net_paid_cents: number; outstanding_cents: number; financial_status: string }>;
  const statusByAppointment = new Map(financialRows.map((item) => [item.appointment_id, item.financial_status]));
  const appointmentRows = requireData(appointments, "Agendamentos financeiros") as Array<{ id: string; organization_id: string; customer_id: string; barber_id: string; status: string; payment_mode: string; total_cents_snapshot: number; created_at: string }>;
  const appointmentById = new Map(appointmentRows.map((item) => [item.id, item]));
  const barberById = new Map((requireData(barbers, "Profissionais financeiros") as Array<{ id: string; display_name: string }>).map((item) => [item.id, item.display_name]));
  const itemNamesByAppointment = new Map<string, string[]>();
  (requireData(appointmentItems, "Itens financeiros") as Array<{ appointment_id: string; service_name_snapshot: string }>).forEach((item) => itemNamesByAppointment.set(item.appointment_id, [...(itemNamesByAppointment.get(item.appointment_id) ?? []), item.service_name_snapshot]));
  const completedAtByAppointment = new Map<string, string>();
  (requireData(statusEvents, "Histórico de atendimentos") as Array<{ appointment_id: string; created_at: string }>).forEach((item) => {
    if (!completedAtByAppointment.has(item.appointment_id)) completedAtByAppointment.set(item.appointment_id, item.created_at);
  });
  const customerById = new Map((requireData(customers, "Clientes financeiros") as Array<{ id: string; full_name: string }>).map((item) => [item.id, item.full_name]));
  const appointmentReceivables: AppointmentReceivableRecord[] = appointmentRows.flatMap((appointment) => {
    const financial = financialRows.find((item) => item.appointment_id === appointment.id);
    if (appointment.status !== "COMPLETED" || appointment.payment_mode !== "COUNTER" || !financial || financial.outstanding_cents <= 0) return [];
    const services = itemNamesByAppointment.get(appointment.id)?.filter(Boolean).join(" + ") || "Atendimento";
    return [{
      appointment_id: appointment.id,
      organization_id: appointment.organization_id,
      customer_id: appointment.customer_id,
      customer_name: customerById.get(appointment.customer_id) ?? "Cliente",
      description: `${services} · Profissional: ${barberById.get(appointment.barber_id) ?? "Não informado"}`,
      amount_cents: appointment.total_cents_snapshot,
      issue_date: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(appointment.created_at)),
      due_date: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(completedAtByAppointment.get(appointment.id) ?? new Date().toISOString())),
      document_number: `ATD-${appointment.id.slice(0, 8).toUpperCase()}`,
      outstanding_cents: financial.outstanding_cents,
    }];
  });
  return {
    organizationId,
    billingStatus: context.billingStatus,
    accounts: requireData(accounts, "Contas financeiras") as FinancialAccountRecord[],
    balances: requireData(balances, "Saldos das contas") as FinancialAccountBalanceRecord[],
    suppliers: requireData(suppliers, "Fornecedores") as SupplierRecord[],
    chartAccounts: requireData(chartAccounts, "Plano de contas") as ChartAccountRecord[],
    costCenters: requireData(costCenters, "Centros de custo") as CostCenterRecord[],
    tags: requireData(tags, "Tags financeiras") as FinancialTagRecord[],
    customers: requireData(customers, "Clientes financeiros") as Pick<CustomerRecord, "id" | "organization_id" | "full_name" | "active">[],
    entries: requireData(entries, "Lançamentos financeiros") as FinancialEntryRecord[],
    entryTags: requireData(entryTags, "Tags dos lançamentos") as FinancialEntryTagRecord[],
    settlements: requireData(settlements, "Liquidações") as FinancialSettlementRecord[],
    appointmentActivity: activityRows.map((item) => {
      const appointment = appointmentById.get(item.appointment_id);
      const services = itemNamesByAppointment.get(item.appointment_id)?.filter(Boolean).join(" + ") || "Atendimento";
      const barber = appointment ? barberById.get(appointment.barber_id) : undefined;
      return { ...item, display_description: `${services} · Profissional: ${barber ?? "Não informado"}`, financial_status: statusByAppointment.get(item.appointment_id) ?? "UNPAID" };
    }),
    mappings: requireData(mappings, "Mapeamentos de recebimento") as PaymentAccountMappingRecord[],
    appointmentReceivables,
  };
}

export async function loadFinancialReportsData() {
  const { context, supabase, organizationId } = await managerClient();
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 11, 1).toISOString().slice(0, 10);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  const [facts, customers, barbers, locations, chartAccounts, costCenters, accounts, budgetVersions] = await Promise.all([
    supabase.from("financial_reporting_facts").select("*").eq("organization_id", organizationId).gte("fact_date", from).lte("fact_date", to).order("fact_date", { ascending: false }).limit(MANAGER_ROW_LIMIT),
    supabase.from("customers").select("id,organization_id,full_name,active").eq("organization_id", organizationId).is("merged_into_customer_id", null).order("full_name").limit(MANAGER_ROW_LIMIT),
    supabase.from("barbers").select("id,organization_id,location_id,display_name,bio,avatar_url,whatsapp_e164,active").eq("organization_id", organizationId).order("display_name").limit(MANAGER_ROW_LIMIT),
    supabase.from("locations").select("id,organization_id,name,address,active").eq("organization_id", organizationId).order("name"),
    supabase.from("chart_of_accounts").select("id,organization_id,parent_id,code,name,kind,active,dre_group,cash_flow_activity").eq("organization_id", organizationId).order("code"),
    supabase.from("cost_centers").select("id,organization_id,name,active").eq("organization_id", organizationId).order("name"),
    supabase.from("financial_accounts").select("id,organization_id,kind,name,bank_code,branch,account_number,description,opening_balance_cents,active").eq("organization_id", organizationId).order("name"),
    supabase.from("financial_budget_versions").select("id,organization_id,budget_id,version_number,status,approved_at").eq("organization_id", organizationId).order("version_number", { ascending: false }).limit(100),
  ]);
  return {
    organizationId,
    billingStatus: context.billingStatus,
    from,
    to,
    facts: requireData(facts, "Fatos financeiros") as FinancialReportingFactRecord[],
    customers: requireData(customers, "Clientes financeiros") as Pick<CustomerRecord, "id" | "organization_id" | "full_name" | "active">[],
    barbers: requireData(barbers, "Profissionais financeiros") as BarberRecord[],
    locations: requireData(locations, "Unidades financeiras") as LocationRecord[],
    chartAccounts: requireData(chartAccounts, "Plano de contas") as ChartAccountRecord[],
    costCenters: requireData(costCenters, "Centros de custo") as CostCenterRecord[],
    accounts: requireData(accounts, "Contas financeiras") as FinancialAccountRecord[],
    budgetVersions: requireData(budgetVersions, "Versões de orçamento") as FinancialBudgetVersionRecord[],
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

export async function loadWhatsAppSettingsData() {
  const { context, supabase, organizationId } = await managerClient();
  const organization = requireData(
    await supabase.from("organizations").select("id,name").eq("id", organizationId).single(),
    "Organização",
  ) as { id: string; name: string };
  const result = await supabase.rpc("get_whatsapp_connection_status", {
    p_organization_id: organizationId,
  });
  const status: WhatsAppSettingsStatus = result.error
    ? {
      connections: [],
      managerNotification: { phoneE164: null, matchesQrPhone: false },
      reminders: [
        { id: "default-6h", position: 1, enabled: true, offset_minutes: 360, template_key: "appointment_reminder_6h", language_code: "pt_BR" },
        { id: "default-45m", position: 2, enabled: true, offset_minutes: 45, template_key: "appointment_reminder_45m", language_code: "pt_BR" },
      ],
      automation: {
        confirmation_enabled: true,
        confirmation_template_key: "appointment_confirmation",
        welcome_enabled: true,
        welcome_message: "*{barbearia}* agradece seu contato.\nPara agendar seu horário, acesse {link}.",
      },
    }
    : (() => {
      const raw = result.data as WhatsAppSettingsStatus & {
        manager_notification?: { phone_e164?: string | null; matches_qr_phone?: boolean };
      };
      return {
        ...raw,
        managerNotification: {
          phoneE164: raw.manager_notification?.phone_e164 ?? null,
          matchesQrPhone: raw.manager_notification?.matches_qr_phone === true,
        },
      };
    })();

  return { organizationId, billingStatus: context.billingStatus, organization, status, schemaReady: !result.error };
}

export async function loadDashboardData() {
  const { context, supabase, organizationId } = await managerClient();
  const from = new Date(Date.now() - 31 * 86_400_000).toISOString();
  const to = new Date(Date.now() + 93 * 86_400_000).toISOString();
  const [organization, appointments, customers, barbers, financial, payouts, whatsappResult] = await Promise.all([
    supabase.from("organizations").select("*").eq("id", organizationId).single(),
    supabase.from("appointments").select("*").eq("organization_id", organizationId).overlaps("service_period", `[${from},${to})`).order("service_period").limit(500),
    supabase.from("customers").select("id,organization_id,auth_user_id,full_name,phone_e164,email,birth_date,notes,active,inactivation_reason,inactivated_at,created_at").eq("organization_id", organizationId).limit(MANAGER_ROW_LIMIT),
    supabase.from("barbers").select("*").eq("organization_id", organizationId).eq("active", true).order("display_name"),
    supabase.from("appointment_financial_summary").select("*").eq("organization_id", organizationId).limit(MANAGER_ROW_LIMIT),
    supabase.from("commission_payouts").select("*").eq("organization_id", organizationId).eq("status", "OPEN"),
    supabase.rpc("get_whatsapp_connection_status", { p_organization_id: organizationId }),
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
    whatsapp: whatsappResult.error ? null : whatsappResult.data as WhatsAppSettingsStatus,
  };
}
