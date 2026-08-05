import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CustomersView } from "@/components/customers-view";
import { PageHeader } from "@/components/ui";
import { hasSupabaseConfig } from "@/lib/env";
import { CustomersManager } from "@/components/connected-manager/customers-manager";
import { loadCustomersData } from "@/components/connected-manager/server";

export const metadata: Metadata = { title: "Clientes" };

export default async function CustomersPage() {
  if (hasSupabaseConfig) {
    const data = await loadCustomersData();
    if (data.billingStatus === "CANCELED_RETENTION" || data.billingStatus === "CLOSED") redirect("/regularizacao");
    return <CustomersManager {...data} />;
  }
  return (
    <div className="customers-page">
      <PageHeader title="Clientes" description="Conheça sua base, acompanhe retornos e fortaleça relacionamentos." />
      <CustomersView />
    </div>
  );
}
