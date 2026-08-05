import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import type {
  AdminAccessEvent,
  AdminControlPlaneData,
  AdminOrganization,
  AdminSubscription,
} from "./types";

const ACCESS_EVENT_LIMIT = 500;

export async function loadAdminControlPlaneData(): Promise<AdminControlPlaneData> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) {
    return {
      organizations: [],
      subscriptions: [],
      accessEvents: [],
      errors: ["Supabase não configurado."],
      loadedAt: new Date().toISOString(),
      accessEventLimit: ACCESS_EVENT_LIMIT,
    };
  }

  const [organizationsResult, subscriptionsResult, accessEventsResult] = await Promise.all([
    supabase
      .from("organizations")
      .select("id,name,slug,timezone,currency,created_at")
      .order("name"),
    supabase
      .from("saas_subscriptions")
      .select("id,organization_id,stripe_price_id,status,trial_ends_at,current_period_ends_at,grace_ends_at,canceled_at,retention_ends_at,updated_at")
      .order("updated_at", { ascending: false }),
    supabase
      .from("organization_access_events")
      .select("id,organization_id,from_status,to_status,reason,created_at")
      .order("created_at", { ascending: false })
      .limit(ACCESS_EVENT_LIMIT),
  ]);

  const errors: string[] = [];
  if (organizationsResult.error) errors.push("Falha ao consultar organizações.");
  if (subscriptionsResult.error) errors.push("Falha ao consultar assinaturas.");
  if (accessEventsResult.error) errors.push("Falha ao consultar auditoria de acesso.");

  return {
    organizations: (organizationsResult.data ?? []) as AdminOrganization[],
    subscriptions: (subscriptionsResult.data ?? []) as AdminSubscription[],
    accessEvents: (accessEventsResult.data ?? []) as AdminAccessEvent[],
    errors,
    loadedAt: new Date().toISOString(),
    accessEventLimit: ACCESS_EVENT_LIMIT,
  };
}
