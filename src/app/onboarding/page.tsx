import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OnboardingFlow } from "@/components/onboarding-flow";
import { getAccessContext } from "@/lib/auth/context";
import { hasSupabaseConfig } from "@/lib/env";
import { getPublishedProductIdentity } from "@/lib/product-identity-server";
import { productIdentityStyle } from "@/lib/product-identity";
import { getSelectedProductKey } from "@/lib/product-context";

export const metadata: Metadata = { title: "Criar barbearia" };

export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  const params = await searchParams;
  const selectedProduct = await getSelectedProductKey();
  const productKey: "los-barberos" | "le-gras" = params.produto === "le-gras" || (params.produto !== "los-barberos" && selectedProduct === "le-gras") ? "le-gras" : "los-barberos";
  const context = hasSupabaseConfig ? await getAccessContext(productKey) : null;

  if (hasSupabaseConfig && !context) redirect("/entrar?next=/onboarding");
  if (context?.role === "OWNER" && context.billingStatus !== "PROVISIONING") redirect("/gestor");
  if (context?.role === "CLIENT") redirect("/cliente/agendar");

  const identity = await getPublishedProductIdentity(productKey);
  return <OnboardingFlow demoMode={!hasSupabaseConfig} existingOrganizationId={context?.role === "OWNER" ? context.organizationId : null} productKey={productKey} productName={identity?.vocabulary.organization ?? (productKey === "le-gras" ? "estúdio" : "barbearia")} identity={identity} identityStyle={productIdentityStyle(identity)} />;
}
