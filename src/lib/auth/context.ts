import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { BillingStatus } from "@/lib/domain/types";

export interface AccessContext {
  userId: string;
  organizationId: string | null;
  role: "OWNER" | "CLIENT" | "PLATFORM_ADMIN";
  billingStatus: BillingStatus | null;
}

export async function getAccessContext(): Promise<AccessContext | null> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  const { data: platformAdmin } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (platformAdmin) {
    return {
      userId: data.user.id,
      organizationId: null,
      role: "PLATFORM_ADMIN",
      billingStatus: null,
    };
  }

  const { data: membership } = await supabase
    .from("organization_memberships")
    .select("organization_id")
    .eq("user_id", data.user.id)
    .eq("active", true)
    .maybeSingle();

  if (membership) {
    const { data: subscription } = await supabase
      .from("saas_subscriptions")
      .select("status")
      .eq("organization_id", membership.organization_id)
      .maybeSingle();
    return {
      userId: data.user.id,
      organizationId: membership.organization_id,
      role: "OWNER",
      billingStatus: (subscription?.status as BillingStatus | undefined) ?? null,
    };
  }

  return {
    userId: data.user.id,
    organizationId: null,
    role: "CLIENT",
    billingStatus: null,
  };
}
