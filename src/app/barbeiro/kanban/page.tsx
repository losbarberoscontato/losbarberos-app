import { redirect } from "next/navigation";
import { BarberShell } from "@/components/connected-barber/barber-shell";
import { ServiceKanban } from "@/components/service-kanban";
import { loadBarberServiceKanban } from "@/lib/service-kanban-server";

export default async function BarberKanbanPage({ searchParams }: { searchParams: Promise<{ barbearia?: string }> }) {
  const params = await searchParams;
  if (!params.barbearia) redirect("/barbeiro");
  const data = await loadBarberServiceKanban(params.barbearia);
  if (!data) redirect(`/barbeiro/agenda?barbearia=${encodeURIComponent(params.barbearia)}`);
  return <BarberShell context={data.context}><ServiceKanban data={data.kanban} /></BarberShell>;
}
