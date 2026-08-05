import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { CatalogView } from "@/components/catalog-view";
import { PageHeader } from "@/components/ui";
import { hasSupabaseConfig } from "@/lib/env";
import { CatalogManager } from "@/components/connected-manager/catalog-manager";
import { loadCatalogData } from "@/components/connected-manager/server";

export const metadata: Metadata = { title: "Serviços e pacotes" };

export default async function CatalogPage() {
  if (hasSupabaseConfig) {
    const data = await loadCatalogData();
    if (data.billingStatus === "CANCELED_RETENTION" || data.billingStatus === "CLOSED") redirect("/regularizacao");
    return <CatalogManager {...data} />;
  }
  return (
    <div className="catalog-page">
      <PageHeader title="Serviços e pacotes" description="Organize seu cardápio, preços, durações e combinações." actions={<button type="button" className="button button--dark"><Plus size={17} /> Adicionar</button>} />
      <CatalogView />
    </div>
  );
}
