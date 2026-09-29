import type { Metadata } from "next";
import { WhatsAppSettings } from "@/components/connected-manager/whatsapp-settings";
import { loadWhatsAppSettingsData } from "@/components/connected-manager/server";
import { getSelectedProductKey } from "@/lib/product-context";

export const metadata: Metadata = { title: "WhatsApp | Configurações" };
export const dynamic = "force-dynamic";

export default async function WhatsAppSettingsPage() {
  const data = await loadWhatsAppSettingsData();
  const productKey = await getSelectedProductKey();
  return <WhatsAppSettings
    organizationId={data.organizationId}
    organizationName={data.organization.name}
    status={data.status}
    schemaReady={data.schemaReady}
    productKey={productKey}
  />;
}
