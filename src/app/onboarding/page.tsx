import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OnboardingFlow } from "@/components/onboarding-flow";
import { getAccessContext } from "@/lib/auth/context";
import { hasSupabaseConfig } from "@/lib/env";
import { getPublishedProductIdentity } from "@/lib/product-identity-server";
import { productIdentityStyle } from "@/lib/product-identity";
import { getSelectedProductKey, parseProductKey, type ProductKey } from "@/lib/product-context";
import { systemLoginHref } from "@/lib/system-auth";

export async function generateMetadata({ searchParams }: PageProps<"/onboarding">): Promise<Metadata> {
  const params = await searchParams;
  const productKey = parseProductKey(params.produto) ?? await getSelectedProductKey();
  const productName = productKey === "le-gras" ? "Le Gras" : productKey === "music-pro" ? "MusicPro" : productKey === "pro-stetic" ? "ProStetic" : "Los Barberos";
  const icon = productKey === "le-gras" ? "/le-gras/icon.svg" : productKey === "music-pro" ? "/music-pro/icon.svg" : productKey === "pro-stetic" ? "/pro-stetic/icon.svg" : "/icon.svg";
  return { title: `Criar ${productKey === "le-gras" || productKey === "pro-stetic" ? "estúdio" : productKey === "music-pro" ? "escola" : "barbearia"} | ${productName}`, icons: { icon, apple: "/icon-192.png" } };
}

export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  const params = await searchParams;
  const selectedProduct = await getSelectedProductKey();
  const productKey: ProductKey = parseProductKey(params.produto) ?? selectedProduct;
  const context = hasSupabaseConfig ? await getAccessContext(productKey) : null;

  if (hasSupabaseConfig && !context) redirect(systemLoginHref("signin", "/onboarding", productKey));
  if (context?.role === "OWNER" && context.billingStatus !== "PROVISIONING") redirect("/gestor");
  if (context?.role === "CLIENT") redirect("/cliente/agendar");

  const identity = await getPublishedProductIdentity(productKey);
  return <OnboardingFlow demoMode={!hasSupabaseConfig} existingOrganizationId={context?.role === "OWNER" ? context.organizationId : null} productKey={productKey} productName={identity?.vocabulary.organization ?? (productKey === "le-gras" || productKey === "pro-stetic" ? "estúdio" : productKey === "music-pro" ? "escola" : "barbearia")} identity={identity} identityStyle={productIdentityStyle(identity)} />;
}
