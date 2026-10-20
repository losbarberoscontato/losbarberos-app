import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ServiceKanban } from "@/components/service-kanban";
import { loadManagerServiceKanban } from "@/lib/service-kanban-server";

export const metadata: Metadata = { title: "Kanban de Atendimentos" };

export default async function ServiceKanbanPage() {
  const data = await loadManagerServiceKanban().catch((error: unknown) => {
    if (error instanceof Error && error.message === "Sessão de gestor inválida.") return null;
    throw error;
  });
  if (!data) redirect("/entrar?next=/gestor/kanban");
  return <ServiceKanban data={data} />;
}
