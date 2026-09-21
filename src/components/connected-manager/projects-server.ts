import "server-only";

import { getAccessContext } from "@/lib/auth/context";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { ChartAccountRecord, CostCenterRecord, FinancialAccountRecord, FinancialTagRecord } from "./types";

export interface ProjectRecord {
  id: string;
  organization_id?: string;
  name: string;
  description: string | null;
  status: "DRAFT" | "PUBLISHED" | "PAUSED" | "CLOSED" | "ARCHIVED";
  starts_on: string | null;
  sales_close_on: string | null;
  ends_on: string | null;
  goal_contracts: number | null;
  created_at: string;
}

export interface ProjectPackageRecord {
  id: string;
  organization_id: string;
  project_id: string;
  name: string;
  description: string | null;
  price_cents: number;
  sessions_count: number;
  duration_minutes: number;
  fixed_cost_per_hour_cents: number;
  extra_costs_cents: number;
  extra_costs_description: string | null;
  tax_rate_bps: number;
  card_rate_bps: number;
  profit_margin_bps: number;
  deposit_cents: number;
  suggested_price_cents: number;
  sort_order: number;
  active: boolean;
}

export interface ProjectStepRecord {
  id: string;
  organization_id: string;
  project_id: string;
  name: string;
  description: string | null;
  position: number;
  kind: "INTERNAL" | "SERVICE";
  service_id: string | null;
  commission_rate_bps: number | null;
  active: boolean;
}

export interface ProjectEngagementRecord {
  id: string;
  organization_id: string;
  project_id: string;
  customer_id: string;
  package_id: string;
  kanban_board_id: string;
  status: "PROPOSAL" | "ACTIVE" | "COMPLETED" | "CANCELED";
  contracted_cents: number;
  proposal_sent_at: string | null;
  accepted_at: string | null;
  event_description?: string | null;
  event_link_1?: string | null;
  event_link_2?: string | null;
  event_link_3?: string | null;
  kanban_received_at?: string | null;
  kanban_received_by?: string | null;
  kanban_received_by_name?: string | null;
  event_due_on?: string | null;
  created_at: string;
}

export interface ProjectEngagementCommentPreview {
  engagement_id: string;
  body: string;
  author_name: string;
  created_at: string;
}

export interface ProjectKanbanBoardRecord {
  id: string;
  organization_id: string;
  project_id: string;
  name: string;
  responsible_barber_id: string;
  sector_id?: string | null;
  system_key: "PROPOSAL" | "ACTIVE" | "COMPLETED" | "CANCELED" | null;
  position: number;
  active: boolean;
  created_at: string;
}

export interface ProjectKanbanSectorRecord {
  id: string;
  organization_id: string;
  name: string;
  position: number;
  responsible_barber_id: string;
  active: boolean;
  created_at: string;
}

export interface ProjectCustomerRecord {
  id: string;
  full_name: string;
  phone_e164: string | null;
  email: string | null;
}

export interface ProjectBarberRecord {
  id: string;
  display_name: string;
}

export interface ProjectBarberServiceRecord {
  barber_id: string;
  service_id: string;
}

export interface ProjectPackageServiceAssignmentRecord {
  id: string;
  project_package_id: string;
  service_id: string;
  barber_id: string;
  commission_cents: number;
}

export interface ProjectCostItemRecord {
  id: string;
  organization_id: string;
  project_id: string;
  kind: "FIXED" | "VARIABLE" | "INVESTMENT";
  name: string;
  description: string | null;
  amount_cents: number;
  active: boolean;
  sort_order: number;
  created_at: string;
}

export interface ProjectInstallmentRecord {
  id: string;
  organization_id?: string;
  engagement_id: string;
  installment_number: number;
  due_on: string;
  amount_cents: number;
  status: "OPEN" | "PAID" | "CANCELED";
  paid_at?: string | null;
  financial_entry_id?: string | null;
  settled_cents?: number;
  remaining_cents?: number;
  last_paid_at?: string | null;
  payment_method?: string | null;
  financial_account_id?: string | null;
  financial_account_name?: string | null;
  received_by?: string | null;
  received_by_name?: string | null;
}

function required<T>(result: { data: T | null; error: { message: string } | null }, label: string): T {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data as T;
}

function optionalPackageServiceAssignments(result: { data: unknown[] | null; error: { message: string } | null }) {
  if (!result.error) return (result.data ?? []) as ProjectPackageServiceAssignmentRecord[];
  if (/project_package_service_assignments|relation .* does not exist/i.test(result.error.message)) return [];
  throw new Error(`Comissões de serviços dos pacotes: ${result.error.message}`);
}

export async function loadProjectsData() {
  const [context, supabase] = await Promise.all([getAccessContext(), getSupabaseServerClient()]);
  if (!context || context.role !== "OWNER" || !context.organizationId || !supabase) {
    throw new Error("Sessão de gestor inválida.");
  }

  const organizationId = context.organizationId;
  const entitlement = await supabase
    .from("organization_module_entitlements")
    .select("enabled,data_retention_status")
    .eq("organization_id", organizationId)
    .eq("module_key", "projects")
    .maybeSingle();
  if (entitlement.error) throw new Error(`Módulo Projetos: ${entitlement.error.message}`);

  const [projects, packages, steps, engagementsRaw, installments, customers, services, barbers, barberServices, packageServiceAssignments, costItems, kanbanBoardsRaw, kanbanSectorsRaw, eventCommentsRaw, financialAccounts, chartAccounts, costCenters, tags] = await Promise.all([
    supabase.from("projects").select("id,organization_id,name,description,status,starts_on,sales_close_on,ends_on,goal_contracts,created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }),
    supabase.from("project_packages").select("id,organization_id,project_id,name,description,price_cents,sessions_count,duration_minutes,fixed_cost_per_hour_cents,extra_costs_cents,extra_costs_description,tax_rate_bps,card_rate_bps,profit_margin_bps,deposit_cents,suggested_price_cents,sort_order,active").eq("organization_id", organizationId).order("sort_order"),
    supabase.from("project_steps").select("id,organization_id,project_id,name,description,position,kind,service_id,commission_rate_bps,active").eq("organization_id", organizationId).order("position"),
    supabase.from("project_engagements").select("id,organization_id,project_id,customer_id,package_id,kanban_board_id,status,contracted_cents,proposal_sent_at,accepted_at,event_description,event_link_1,event_link_2,event_link_3,kanban_received_at,kanban_received_by,kanban_received_by_name,event_due_on,created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }),
    supabase.from("project_installment_finance").select("id,organization_id,engagement_id,installment_number,due_on,amount_cents,status,paid_at,financial_entry_id,settled_cents,remaining_cents,last_paid_at,payment_method,financial_account_id,financial_account_name,received_by,received_by_name").eq("organization_id", organizationId).order("installment_number").order("due_on"),
    supabase.from("customers").select("id,full_name,phone_e164,email").eq("organization_id", organizationId).is("merged_into_customer_id", null).eq("active", true).order("full_name"),
    supabase.from("services").select("id,name,price_cents,active,availability").eq("organization_id", organizationId).eq("active", true).order("name"),
    supabase.from("barbers").select("id,display_name").eq("organization_id", organizationId).eq("active", true).order("display_name"),
    supabase.from("barber_services").select("barber_id,service_id").eq("organization_id", organizationId).eq("active", true),
    supabase.from("project_package_service_assignments").select("id,project_package_id,service_id,barber_id,commission_cents").eq("organization_id", organizationId),
    supabase.from("project_cost_items").select("id,organization_id,project_id,kind,name,description,amount_cents,active,sort_order,created_at").eq("organization_id", organizationId).eq("active", true).in("kind", ["FIXED", "INVESTMENT"]).order("sort_order").order("created_at", { ascending: false }),
    supabase.from("project_kanban_boards").select("id,organization_id,project_id,name,system_key,position,responsible_barber_id,sector_id,active,created_at").eq("organization_id", organizationId).eq("active", true).order("position").order("created_at"),
    supabase.from("project_kanban_sectors").select("id,organization_id,name,position,responsible_barber_id,active,created_at").eq("organization_id", organizationId).eq("active", true).order("position").order("created_at"),
    supabase.from("project_engagement_comments").select("engagement_id,body,author_name,created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }),
    supabase.from("financial_accounts").select("id,organization_id,kind,name,bank_code,branch,account_number,description,opening_balance_cents,active").eq("organization_id", organizationId).eq("active", true).order("name"),
    supabase.from("chart_of_accounts").select("id,organization_id,parent_id,code,name,kind,dre_group,cash_flow_activity,active").eq("organization_id", organizationId).eq("active", true).order("code").order("name"),
    supabase.from("cost_centers").select("id,organization_id,name,active").eq("organization_id", organizationId).eq("active", true).order("name"),
    supabase.from("financial_tags").select("id,organization_id,name,color,active").eq("organization_id", organizationId).eq("active", true).order("name"),
  ]);

  const installmentRows = installments.error && /project_installment_finance|relation .* does not exist/i.test(installments.error.message)
    ? await supabase.from("project_installments").select("id,organization_id,engagement_id,installment_number,due_on,amount_cents,status,paid_at").eq("organization_id", organizationId).order("installment_number").order("due_on").then((result) => ({ ...result, data: (result.data ?? []).map((row) => ({ ...row, financial_entry_id: null, settled_cents: 0, remaining_cents: row.amount_cents, last_paid_at: null, payment_method: null, financial_account_id: null, financial_account_name: null, received_by: null, received_by_name: null })) }))
    : installments;

  let engagements: { data: unknown[] | null; error: { message: string } | null } = engagementsRaw as { data: unknown[] | null; error: { message: string } | null };
  if (engagementsRaw.error && /event_description|event_link_[123]|kanban_received_|event_due_on|column .* does not exist/i.test(engagementsRaw.error.message)) {
    const eventOnly = await supabase.from("project_engagements").select("id,organization_id,project_id,customer_id,package_id,kanban_board_id,status,contracted_cents,proposal_sent_at,accepted_at,event_description,event_link_1,event_link_2,event_link_3,kanban_received_at,kanban_received_by,kanban_received_by_name,event_due_on,created_at").eq("organization_id", organizationId).order("created_at", { ascending: false });
    engagements = eventOnly.error && /event_description|event_link_[123]|column .* does not exist/i.test(eventOnly.error.message)
      ? await supabase.from("project_engagements").select("id,organization_id,project_id,customer_id,package_id,kanban_board_id,status,contracted_cents,proposal_sent_at,accepted_at,created_at").eq("organization_id", organizationId).order("created_at", { ascending: false })
      : eventOnly;
  }

  const kanbanBoards = kanbanBoardsRaw.error && /sector_id|column .* does not exist/i.test(kanbanBoardsRaw.error.message)
    ? await supabase.from("project_kanban_boards").select("id,organization_id,project_id,name,system_key,position,responsible_barber_id,active,created_at").eq("organization_id", organizationId).eq("active", true).order("position").order("created_at")
    : kanbanBoardsRaw;
  const kanbanSectors = kanbanSectorsRaw.error && /project_kanban_sectors|relation .* does not exist|could not find the (table|relation)|schema cache/i.test(kanbanSectorsRaw.error.message)
    ? { data: [], error: null }
    : kanbanSectorsRaw;
  const eventComments = eventCommentsRaw.error && /project_engagement_comments|relation .* does not exist|could not find the (table|relation)|schema cache/i.test(eventCommentsRaw.error.message)
    ? { data: [], error: null }
    : eventCommentsRaw;
  const engagementLastComments = ((eventComments.data ?? []) as ProjectEngagementCommentPreview[]).reduce<Record<string, ProjectEngagementCommentPreview>>((result, comment) => {
    if (!result[comment.engagement_id]) result[comment.engagement_id] = comment;
    return result;
  }, {});

  return {
    organizationId,
    enabled: Boolean(entitlement.data?.enabled),
    retentionStatus: entitlement.data?.data_retention_status ?? "NONE",
    projects: required(projects, "Projetos") as ProjectRecord[],
    packages: required(packages, "Pacotes de projetos") as ProjectPackageRecord[],
    steps: required(steps, "Etapas de projetos") as ProjectStepRecord[],
    engagements: required(engagements, "Contratações de projetos") as ProjectEngagementRecord[],
    installments: required(installmentRows, "Parcelas de projetos") as ProjectInstallmentRecord[],
    customers: required(customers, "Clientes") as ProjectCustomerRecord[],
    services: required(services, "Serviços") as Array<{ id: string; name: string; price_cents: number; active: boolean; availability?: "CLIENT" | "HIDDEN" | "INTERNAL" }>,
    barbers: required(barbers, "Profissionais") as ProjectBarberRecord[],
    barberServices: required(barberServices, "Serviços habilitados dos profissionais") as ProjectBarberServiceRecord[],
    packageServiceAssignments: optionalPackageServiceAssignments(packageServiceAssignments),
    costItems: required(costItems, "Custos dos projetos") as ProjectCostItemRecord[],
    kanbanBoards: required(kanbanBoards, "Quadros do Kanban") as ProjectKanbanBoardRecord[],
    kanbanSectors: required(kanbanSectors, "Setores do Kanban Geral") as ProjectKanbanSectorRecord[],
    engagementLastComments,
    financialAccounts: required(financialAccounts, "Contas financeiras") as FinancialAccountRecord[],
    chartAccounts: required(chartAccounts, "Plano de contas") as ChartAccountRecord[],
    costCenters: required(costCenters, "Centros de custo") as CostCenterRecord[],
    tags: required(tags, "Tags financeiras") as FinancialTagRecord[],
  };
}

export type ProjectsPageData = Awaited<ReturnType<typeof loadProjectsData>>;
