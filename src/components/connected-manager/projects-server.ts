import "server-only";

import { getAccessContext } from "@/lib/auth/context";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export interface ProjectRecord {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  status: "DRAFT" | "PUBLISHED" | "PAUSED" | "CLOSED";
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
  status: "PROPOSAL" | "ACTIVE" | "COMPLETED" | "CANCELED";
  contracted_cents: number;
  proposal_sent_at: string | null;
  accepted_at: string | null;
  created_at: string;
}

export interface ProjectCustomerRecord {
  id: string;
  full_name: string;
  phone_e164: string | null;
  email: string | null;
}

export interface ProjectInstallmentRecord {
  id: string;
  engagement_id: string;
  due_on: string;
  amount_cents: number;
  status: "OPEN" | "PAID" | "CANCELED";
}

function required<T>(result: { data: T | null; error: { message: string } | null }, label: string): T {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data as T;
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

  const [projects, packages, steps, engagements, installments, customers, services] = await Promise.all([
    supabase.from("projects").select("id,organization_id,name,description,status,starts_on,sales_close_on,ends_on,goal_contracts,created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }),
    supabase.from("project_packages").select("id,organization_id,project_id,name,description,price_cents,sessions_count,sort_order,active").eq("organization_id", organizationId).order("sort_order"),
    supabase.from("project_steps").select("id,organization_id,project_id,name,description,position,kind,service_id,commission_rate_bps,active").eq("organization_id", organizationId).order("position"),
    supabase.from("project_engagements").select("id,organization_id,project_id,customer_id,package_id,status,contracted_cents,proposal_sent_at,accepted_at,created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }),
    supabase.from("project_installments").select("id,engagement_id,due_on,amount_cents,status").eq("organization_id", organizationId).order("due_on"),
    supabase.from("customers").select("id,full_name,phone_e164,email").eq("organization_id", organizationId).is("merged_into_customer_id", null).eq("active", true).order("full_name"),
    supabase.from("services").select("id,name,price_cents,active").eq("organization_id", organizationId).eq("active", true).order("name"),
  ]);

  return {
    organizationId,
    enabled: Boolean(entitlement.data?.enabled),
    retentionStatus: entitlement.data?.data_retention_status ?? "NONE",
    projects: required(projects, "Projetos") as ProjectRecord[],
    packages: required(packages, "Pacotes de projetos") as ProjectPackageRecord[],
    steps: required(steps, "Etapas de projetos") as ProjectStepRecord[],
    engagements: required(engagements, "Contratações de projetos") as ProjectEngagementRecord[],
    installments: required(installments, "Parcelas de projetos") as ProjectInstallmentRecord[],
    customers: required(customers, "Clientes") as ProjectCustomerRecord[],
    services: required(services, "Serviços") as Array<{ id: string; name: string; price_cents: number; active: boolean }>,
  };
}

export type ProjectsPageData = Awaited<ReturnType<typeof loadProjectsData>>;
