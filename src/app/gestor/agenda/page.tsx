import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AgendaBoard } from "@/components/agenda-board";
import { PageHeader } from "@/components/ui";
import { hasSupabaseConfig } from "@/lib/env";
import { AgendaManager } from "@/components/connected-manager/agenda-manager";
import { loadAgendaData } from "@/components/connected-manager/server";

export const metadata: Metadata = { title: "Agenda" };

export default async function AgendaPage() {
  if (hasSupabaseConfig) {
    const data = await loadAgendaData();
    if (data.billingStatus === "CANCELED_RETENTION" || data.billingStatus === "CLOSED") redirect("/regularizacao");
    return <AgendaManager {...data} />;
  }
  return (
    <div className="agenda-page">
      <PageHeader title="Agenda" description="Organize equipe, horários e atendimentos em tempo real." />
      <AgendaBoard />
    </div>
  );
}
