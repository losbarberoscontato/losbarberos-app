"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

type NavigationAccess = { scope: string; subscriptionAccess: boolean | null; unread: boolean };

export function useNavigationAccess(
  supabase: SupabaseClient | null,
  context: { organization: { id: string } } | null,
  customer: { id: string } | null,
  user: { id: string } | null,
) {
  const organizationId = context?.organization.id;
  const customerId = customer?.id;
  const userId = user?.id;
  const scope = JSON.stringify([organizationId, customerId, userId]);
  const enabled = Boolean(supabase && organizationId && customerId && userId);
  const [access, setAccess] = useState<NavigationAccess | null>(null);

  useEffect(() => {
    if (!supabase || !organizationId || !customerId || !userId) return;
    let active = true;
    let pendingUnread: Promise<boolean> | null = null;
    // Reuse only an in-flight request. No TTL, cross-tenant or session cache.
    const loadUnread = () => {
      pendingUnread ??= (async () => {
        const { count } = await supabase.from("customer_in_app_notifications")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId).eq("customer_id", customerId).is("read_at", null);
        const unread = (count ?? 0) > 0;
        if (active) setAccess((current) => ({
          scope,
          subscriptionAccess: current?.scope === scope ? current.subscriptionAccess : null,
          unread,
        }));
        return unread;
      })().finally(() => { pendingUnread = null; });
      return pendingUnread;
    };

    void (async () => {
      try {
        const [{ count }, subscriptionModule, projectModule, unread] = await Promise.all([
          supabase.from("customer_subscriptions").select("id", { count: "exact", head: true })
            .eq("organization_id", organizationId).eq("customer_id", customerId).eq("status", "ACTIVE"),
          supabase.rpc("organization_module_enabled", { p_organization_id: organizationId, p_module_key: "subscription_plans" }),
          supabase.rpc("organization_module_enabled", { p_organization_id: organizationId, p_module_key: "projects" }),
          loadUnread(),
        ]);
        if (active) setAccess((current) => ({
          scope,
          subscriptionAccess: Boolean(subscriptionModule.data) || Boolean(projectModule.data) || (count ?? 0) > 0 || unread,
          unread: current?.scope === scope ? current.unread : unread,
        }));
      } catch {
        if (active) setAccess((current) => ({ scope, subscriptionAccess: false, unread: current?.scope === scope && current.unread }));
      }
    })();

    // Keep the existing 30-second update cadence, including background tabs.
    const timer = window.setInterval(() => { void loadUnread().catch(() => {}); }, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  // Preserve refreshes when the provider reloads customer/context/permissions.
  }, [supabase, organizationId, customerId, userId, scope, context, customer, user]);

  // Hide the previous tenant/user's state synchronously, before effects run.
  return enabled && access?.scope === scope
    ? { subscriptionAccess: access.subscriptionAccess, commercialOfferUnread: access.unread }
    : { subscriptionAccess: enabled ? null : false, commercialOfferUnread: false };
}
