import { getSupabaseServerClient } from "@/lib/supabase/server";
import { cache } from "react";
import type { BillingStatus } from "@/lib/domain/types";
import { getSelectedProductKey, type ProductKey } from "@/lib/product-context";

export interface AccessContext {
  userId: string;
  organizationId: string | null;
  role: "OWNER" | "CLIENT" | "PLATFORM_ADMIN" | "UNREGISTERED";
  billingStatus: BillingStatus | null;
}

export async function getAccessContext(productKey?: ProductKey): Promise<AccessContext | null> {
  // Resolve the optional argument first: layout and page must share the same
  // request-local entry, even when only the layout supplies the product key.
  return getProductAccessContext(productKey ?? await getSelectedProductKey());
}

const getProductAccessContext = cache(async (selectedProduct: ProductKey): Promise<AccessContext | null> => {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  const { data: assignmentRows } = await supabase
    .from("organization_product_assignments")
    .select("organization_id")
    .eq("product_key", selectedProduct);
  const organizationIds = (assignmentRows ?? []).map((row) => row.organization_id);

  const [membershipResult, clientAccountResult, platformAdminResult] = await Promise.all([
    organizationIds.length ? supabase
      .from("organization_memberships")
      .select("organization_id")
      .eq("user_id", data.user.id)
      .eq("active", true)
      .eq("role", "OWNER")
      .in("organization_id", organizationIds)
      .maybeSingle() : Promise.resolve({ data: null, error: null }),
    selectedProduct === "los-barberos" ? supabase
      .from("client_accounts")
      .select("auth_user_id")
      .eq("auth_user_id", data.user.id)
      .maybeSingle() : Promise.resolve({ data: null, error: null }),
    supabase
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", data.user.id)
      .maybeSingle(),
  ]);
  const membership = membershipResult.data;

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

  if (clientAccountResult.data) {
    return {
      userId: data.user.id,
      organizationId: null,
      role: "CLIENT",
      billingStatus: null,
    };
  }

  return {
    userId: data.user.id,
    organizationId: null,
    role: platformAdminResult.data ? "PLATFORM_ADMIN" : "UNREGISTERED",
    billingStatus: null,
  };
});

export async function isPlatformAdminUser(userId: string): Promise<boolean> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return false;

  const { data, error } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  return !error && Boolean(data);
}
