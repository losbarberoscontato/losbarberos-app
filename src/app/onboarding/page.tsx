import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OnboardingFlow } from "@/components/onboarding-flow";
import { getAccessContext } from "@/lib/auth/context";
import { hasSupabaseConfig } from "@/lib/env";

export const metadata: Metadata = { title: "Criar barbearia" };

export default async function OnboardingPage() {
  const context = hasSupabaseConfig ? await getAccessContext() : null;

  if (hasSupabaseConfig && !context) redirect("/entrar?next=/onboarding");
  if (context?.role === "OWNER" && context.billingStatus !== "PROVISIONING") redirect("/gestor");
  if (context?.role === "PLATFORM_ADMIN") redirect("/admin");

  return <OnboardingFlow demoMode={!hasSupabaseConfig} existingOrganizationId={context?.role === "OWNER" ? context.organizationId : null} />;
}
