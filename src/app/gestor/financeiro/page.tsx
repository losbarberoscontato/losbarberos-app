import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Download } from "lucide-react";
import { FinanceView } from "@/components/finance-view";
import { PageHeader } from "@/components/ui";
import { hasSupabaseConfig } from "@/lib/env";
import { FinanceManager } from "@/components/connected-manager/finance-manager";
import { FinanceSubnav } from "@/components/connected-manager/cash-manager";
import { loadFinanceData } from "@/components/connected-manager/server";

export const metadata: Metadata = { title: "Financeiro e comissões" };

export default async function FinancePage() {
  if (hasSupabaseConfig) {
    const data = await loadFinanceData();
    if (data.billingStatus === "CANCELED_RETENTION" || data.billingStatus === "CLOSED") redirect("/regularizacao");
    return <FinanceManager {...data} />;
  }
  return (
    <div className="finance-page">
      <PageHeader title="Financeiro" description="Recebimentos, saldos, reembolsos e comissões sem perder o histórico." actions={<button type="button" className="button button--soft"><Download size={16} /> Exportar relatório</button>} />
      <FinanceSubnav active="overview" />
      <FinanceView />
    </div>
  );
}
