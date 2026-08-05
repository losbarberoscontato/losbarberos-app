import type { Metadata } from "next";
import { SettingsView } from "@/components/settings-view";
import { PageHeader } from "@/components/ui";
import { hasSupabaseConfig } from "@/lib/env";
import { SettingsManager } from "@/components/connected-manager/settings-manager";
import { loadSettingsData } from "@/components/connected-manager/server";

export const metadata: Metadata = { title: "Configurações" };

export default async function SettingsPage() {
  if (hasSupabaseConfig) return <SettingsManager {...await loadSettingsData()} />;
  return (
    <div className="settings-page">
      <PageHeader title="Configurações" description="Identidade, regras e integrações da sua barbearia." />
      <SettingsView />
    </div>
  );
}
