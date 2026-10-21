import "server-only";

import { getAccessContext } from "@/lib/auth/context";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getBarberAppContext } from "@/lib/barber-server";

export type ServiceKanbanBoard = { id: string; name: string; position: number; system_key: string | null; responsible_barber_id: string | null };
export type ServiceKanbanCard = {
  id: string; board_id: string; appointment_id: string | null; customer_id: string | null;
  service_id: string | null; title: string; description: string | null; origin_barber_id: string; responsible_barber_id: string;
  due_on: string | null; received_at: string; received_by_name: string; archived_at: string | null; created_at: string;
};
export type ServiceKanbanCardComment = { id: string; card_id: string; body: string; author_user_id: string; author_name: string; created_at: string; updated_at: string };
export type ServiceKanbanCardLink = { id: string; card_id: string; label: string; url: string; created_by_user_id: string; created_by_role: "OWNER" | "BARBER"; created_at: string };
export type ServiceKanbanData = {
  organizationId: string;
  actorUserId: string | null;
  manager: boolean;
  enabled: boolean;
  boards: ServiceKanbanBoard[];
  cards: ServiceKanbanCard[];
  comments: ServiceKanbanCardComment[];
  links: ServiceKanbanCardLink[];
  barbers: { id: string; display_name: string }[];
  customers: { id: string; full_name: string; phone_e164: string | null }[];
  services: { id: string; name: string }[];
};

async function load(organizationId: string, manager: boolean): Promise<ServiceKanbanData> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) throw new Error("Supabase indisponível.");
  const entitlement = await supabase.from("organization_module_entitlements")
    .select("enabled").eq("organization_id", organizationId).eq("module_key", "kanban").maybeSingle();
  if (entitlement.error) throw new Error(entitlement.error.message);
  const { data: authData } = await supabase.auth.getUser();
  const actorUserId = authData.user?.id ?? null;
  const enabled = Boolean(entitlement.data?.enabled);
  if (!enabled) return { organizationId, actorUserId, manager, enabled, boards: [], cards: [], comments: [], links: [], barbers: [], customers: [], services: [] };
  const [boards, cards, barbers, services] = await Promise.all([
    supabase.from("service_kanban_boards").select("id,name,position,system_key,responsible_barber_id")
      .eq("organization_id", organizationId).order("position"),
    supabase.from("service_kanban_cards").select("id,board_id,appointment_id,customer_id,service_id,title,description,due_on,received_at,received_by_name,origin_barber_id,responsible_barber_id,archived_at,created_at")
      .eq("organization_id", organizationId).order("created_at", { ascending: false }),
    supabase.from("barbers").select("id,display_name").eq("organization_id", organizationId).eq("active", true).eq("app_access_enabled", true).order("display_name"),
    supabase.from("services").select("id,name").eq("organization_id", organizationId).eq("active", true).order("name"),
  ]);
  for (const result of [boards, cards, barbers, services]) if (result.error) throw new Error(result.error.message);
  const cardIds = (cards.data ?? []).map((card) => card.id);
  const customerIds = [...new Set((cards.data ?? []).map((card) => card.customer_id).filter((id): id is string => Boolean(id)))];
  const [comments, links, customerDirectory, cardCustomers] = await Promise.all([
    cardIds.length ? supabase.from("service_kanban_card_comments").select("id,card_id,body,author_user_id,author_name,created_at,updated_at").eq("organization_id", organizationId).in("card_id", cardIds).order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
    cardIds.length ? supabase.from("service_kanban_card_links").select("id,card_id,label,url,created_by_user_id,created_by_role,created_at").eq("organization_id", organizationId).in("card_id", cardIds).order("created_at") : Promise.resolve({ data: [], error: null }),
    manager ? supabase.from("customers").select("id,full_name,phone_e164").eq("organization_id", organizationId).eq("active", true).is("merged_into_customer_id", null).order("full_name").limit(1_000) : Promise.resolve({ data: [], error: null }),
    customerIds.length ? supabase.from("customers").select("id,full_name,phone_e164").eq("organization_id", organizationId).in("id", customerIds).order("full_name") : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [comments, links, customerDirectory, cardCustomers]) if (result.error) throw new Error(result.error.message);
  const customerMap = new Map<string, { id: string; full_name: string; phone_e164: string | null }>();
  for (const customer of [...(customerDirectory.data ?? []), ...(cardCustomers.data ?? [])]) customerMap.set(customer.id, customer);
  return {
    organizationId, actorUserId, manager, enabled,
    boards: (boards.data ?? []) as ServiceKanbanBoard[],
    cards: (cards.data ?? []) as ServiceKanbanCard[],
    comments: (comments.data ?? []) as ServiceKanbanCardComment[],
    links: (links.data ?? []) as ServiceKanbanCardLink[],
    barbers: (barbers.data ?? []) as { id: string; display_name: string }[],
    customers: [...customerMap.values()].sort((a, b) => a.full_name.localeCompare(b.full_name, "pt-BR")),
    services: (services.data ?? []) as { id: string; name: string }[],
  };
}

export async function loadManagerServiceKanban(): Promise<ServiceKanbanData> {
  const context = await getAccessContext();
  if (!context?.organizationId || context.role !== "OWNER") throw new Error("Sessão de gestor inválida.");
  return load(context.organizationId, true);
}

export async function loadBarberServiceKanban(slug: string): Promise<{ context: NonNullable<Awaited<ReturnType<typeof getBarberAppContext>>>; kanban: ServiceKanbanData } | null> {
  const context = await getBarberAppContext(slug);
  if (!context) return null;
  const kanban = await load(context.organization_id, false);
  return { context, kanban };
}
