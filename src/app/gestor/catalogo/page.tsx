import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { CatalogView } from "@/components/catalog-view";
import { PageHeader } from "@/components/ui";
import { hasSupabaseConfig } from "@/lib/env";
import { CatalogManager } from "@/components/connected-manager/catalog-manager";
import { loadCatalogData } from "@/components/connected-manager/server";
import { getSelectedProductKey } from "@/lib/product-context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await getSelectedProductKey() === "music-pro" ? "Cursos" : "Serviços" };
}

export default async function CatalogPage() {
  const productKey = await getSelectedProductKey();
  if (hasSupabaseConfig) {
    const data = await loadCatalogData();
    if (data.billingStatus === "CANCELED_RETENTION" || data.billingStatus === "CLOSED") redirect("/regularizacao");
    return <CatalogManager {...data} productKey={productKey} />;
  }
  return (
    <div className="catalog-page">
      <PageHeader title={productKey === "music-pro" ? "Cursos" : "Serviços"} description={productKey === "music-pro" ? "Organize cursos, valores, durações e combinações." : "Organize serviços, preços, durações e combinações."} actions={<button type="button" className="button button--dark"><Plus size={17} /> {productKey === "music-pro" ? "Adicionar curso" : "Adicionar"}</button>} />
      <CatalogView />
    </div>
  );
}
