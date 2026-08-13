import type { Metadata } from "next";
import { WhatsAppSettings } from "@/components/connected-manager/whatsapp-settings";
import { loadWhatsAppSettingsData } from "@/components/connected-manager/server";

export const metadata: Metadata = { title: "WhatsApp | Configurações" };
export const dynamic = "force-dynamic";

export default async function WhatsAppSettingsPage() {
  const data = await loadWhatsAppSettingsData();
  return <WhatsAppSettings
    organizationId={data.organizationId}
    organizationName={data.organization.name}
    status={data.status}
    schemaReady={data.schemaReady}
  />;
}
