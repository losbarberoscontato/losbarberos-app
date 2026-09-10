import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { hasSupabaseConfig } from "@/lib/env";
import { ModulesManager } from "@/components/connected-manager/modules-manager";
import { loadModulesData } from "@/components/connected-manager/server";

export const metadata: Metadata = { title: "Módulos" };

export default async function ModulesPage() {
  if (!hasSupabaseConfig) redirect("/gestor/configuracoes");
  const data = await loadModulesData();
  if (data.billingStatus === "CANCELED_RETENTION" || data.billingStatus === "CLOSED") redirect("/regularizacao");
  return <ModulesManager {...data} />;
}
