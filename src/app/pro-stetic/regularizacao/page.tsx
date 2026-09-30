import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BillingRegularization } from "@/components/billing-regularization";
import { getAccessContext } from "@/lib/auth/context";
import { hasSupabaseConfig } from "@/lib/env";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getPublishedProductIdentity } from "@/lib/product-identity-server";
import { systemLoginHref } from "@/lib/system-auth";

export const metadata: Metadata = {
  title: { absolute: "Ajuda e plano | ProStetic" },
  icons: { icon: [{ url: "/pro-stetic/icon.svg", type: "image/svg+xml" }] },
};

export default async function ProSteticBillingPage() {
  const context = hasSupabaseConfig ? await getAccessContext("pro-stetic") : null;
  if (hasSupabaseConfig && !context) redirect(systemLoginHref("signin", "/pro-stetic/regularizacao", "pro-stetic"));
  if (context?.role === "CLIENT") redirect("/cliente/agendar");
  if (context?.role === "PLATFORM_ADMIN" || context?.role === "UNREGISTERED") redirect("/onboarding");

  let graceEndsAt: string | null = null;
  let retentionEndsAt: string | null = null;
  if (context?.organizationId) {
    const supabase = await getSupabaseServerClient();
    const { data: subscription } = supabase
      ? await supabase.from("saas_subscriptions").select("grace_ends_at,retention_ends_at").eq("organization_id", context.organizationId).maybeSingle()
      : { data: null };
    graceEndsAt = subscription?.grace_ends_at ?? null;
    retentionEndsAt = subscription?.retention_ends_at ?? null;
  }

  return <BillingRegularization
    organizationId={context?.organizationId ?? null}
    billingStatus={context?.billingStatus ?? null}
    graceEndsAt={graceEndsAt}
    retentionEndsAt={retentionEndsAt}
    productKey="pro-stetic"
    identity={await getPublishedProductIdentity("pro-stetic")}
  />;
}
