import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { hasSupabaseConfig } from "@/lib/env";
import { SubscriptionPlansManager } from "@/components/connected-manager/subscription-plans-manager";
import { loadSubscriptionPlansData } from "@/components/connected-manager/server";

export const metadata: Metadata = { title: "Planos de Assinatura" };

export default async function SubscriptionPlansPage() {
  if (!hasSupabaseConfig) redirect("/gestor/catalogo");
  const data = await loadSubscriptionPlansData();
  if (data.billingStatus === "CANCELED_RETENTION" || data.billingStatus === "CLOSED") redirect("/regularizacao");
  return <SubscriptionPlansManager {...data} />;
}
