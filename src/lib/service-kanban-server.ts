import "server-only";

import { getAccessContext } from "@/lib/auth/context";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getBarberAppContext } from "@/lib/barber-server";

export type ServiceKanbanBoard = { id: string; name: string; position: number; system_key: string | null; responsible_barber_id: string | null };
export type ServiceKanbanCard = {
  id: string; board_id: string; appointment_id: string | null; customer_id: string | null;
  service_id: string | null; title: string; description: string | null; origin_barber_id: string; responsible_barber_id: string;
  archived_at: string | null; created_at: string;
};
export type ServiceKanbanData = {
  organizationId: string;
  manager: boolean;
  enabled: boolean;
  boards: ServiceKanbanBoard[];
  cards: ServiceKanbanCard[];
  barbers: { id: string; display_name: string }[];
  customers: { id: string; full_name: string }[];
  services: { id: string; name: string }[];
};

async function load(organizationId: string, manager: boolean): Promise<ServiceKanbanData> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) throw new Error("Supabase indisponível.");
  const entitlement = await supabase.from("organization_module_entitlements")
    .select("enabled").eq("organization_id", organizationId).eq("module_key", "kanban").maybeSingle();
  if (entitlement.error) throw new Error(entitlement.error.message);
  const enabled = Boolean(entitlement.data?.enabled);
  if (!enabled) return { organizationId, manager, enabled, boards: [], cards: [], barbers: [], customers: [], services: [] };
  const [boards, cards, barbers, customers, services] = await Promise.all([
    supabase.from("service_kanban_boards").select("id,name,position,system_key,responsible_barber_id")
      .eq("organization_id", organizationId).order("position"),
    supabase.from("service_kanban_cards").select("id,board_id,appointment_id,customer_id,service_id,title,description,origin_barber_id,responsible_barber_id,archived_at,created_at")
      .eq("organization_id", organizationId).order("created_at", { ascending: false }),
    supabase.from("barbers").select("id,display_name").eq("organization_id", organizationId).eq("active", true).eq("app_access_enabled", true).order("display_name"),
    manager ? supabase.from("customers").select("id,full_name").eq("organization_id", organizationId).eq("active", true).order("full_name") : Promise.resolve({ data: [], error: null }),
    manager ? supabase.from("services").select("id,name").eq("organization_id", organizationId).eq("active", true).order("name") : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [boards, cards, barbers, customers, services]) if (result.error) throw new Error(result.error.message);
  return {
    organizationId, manager, enabled,
    boards: (boards.data ?? []) as ServiceKanbanBoard[],
    cards: (cards.data ?? []) as ServiceKanbanCard[],
    barbers: (barbers.data ?? []) as { id: string; display_name: string }[],
    customers: (customers.data ?? []) as { id: string; full_name: string }[],
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
