import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OnboardingFlow } from "@/components/onboarding-flow";
import { getAccessContext } from "@/lib/auth/context";
import { hasSupabaseConfig } from "@/lib/env";
import { getPublishedProductIdentity } from "@/lib/product-identity-server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { productIdentityStyle } from "@/lib/product-identity";

export const metadata: Metadata = { title: "Criar barbearia" };

export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  const params = await searchParams;
  let productKey: "los-barberos" | "le-gras" = params.produto === "le-gras" ? "le-gras" : "los-barberos";
  const context = hasSupabaseConfig ? await getAccessContext() : null;

  if (context?.role === "OWNER") {
    const supabase = await getSupabaseServerClient();
    if (supabase) {
      const { data: assignment } = await supabase.from("organization_product_assignments").select("product_key").eq("organization_id", context.organizationId).maybeSingle();
      if (assignment?.product_key === "le-gras" || assignment?.product_key === "los-barberos") productKey = assignment.product_key;
    }
  }

  if (hasSupabaseConfig && !context) redirect("/entrar?next=/onboarding");
  if (context?.role === "OWNER" && context.billingStatus !== "PROVISIONING") redirect("/gestor");
  if (context?.role === "CLIENT") redirect("/cliente/agendar");

  const identity = await getPublishedProductIdentity(productKey);
  return <OnboardingFlow demoMode={!hasSupabaseConfig} existingOrganizationId={context?.role === "OWNER" ? context.organizationId : null} productKey={productKey} productName={identity?.vocabulary.organization ?? (productKey === "le-gras" ? "estúdio" : "barbearia")} identity={identity} identityStyle={productIdentityStyle(identity)} />;
}
