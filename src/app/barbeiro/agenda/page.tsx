import { redirect } from "next/navigation";
import { BarberAgenda } from "@/components/connected-barber/agenda";
import { BarberShell } from "@/components/connected-barber/barber-shell";
import { loadBarberAgenda } from "@/lib/barber-server";

export default async function BarberAgendaPage({ searchParams }: { searchParams: Promise<{ barbearia?: string }> }) {
  const params = await searchParams;
  if (!params.barbearia) redirect("/barbeiro");
  const data = await loadBarberAgenda(params.barbearia);
  if (!data) redirect("/barbeiro");
  return <BarberShell context={data.context}><BarberAgenda {...data} /></BarberShell>;
}
