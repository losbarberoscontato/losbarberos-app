import { redirect } from "next/navigation";
import { BarberProjectsList } from "@/components/connected-barber/projects";
import { BarberShell } from "@/components/connected-barber/barber-shell";
import { loadBarberProjects } from "@/lib/barber-server";

export default async function BarberProjectsPage({ searchParams }: { searchParams: Promise<{ barbearia?: string }> }) {
  const params = await searchParams;
  if (!params.barbearia) redirect("/barbeiro");
  const data = await loadBarberProjects(params.barbearia);
  if (!data) redirect(`/barbeiro/agenda?barbearia=${encodeURIComponent(params.barbearia)}`);
  return <BarberShell context={data.context}><BarberProjectsList data={data} /></BarberShell>;
}
