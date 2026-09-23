import { redirect } from "next/navigation";
import { BarberProjectKanban } from "@/components/connected-barber/projects";
import { BarberShell } from "@/components/connected-barber/barber-shell";
import { loadBarberProject } from "@/lib/barber-server";

export default async function BarberProjectPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ barbearia?: string }> }) {
  const route = await params; const query = await searchParams;
  if (!query.barbearia) redirect("/barbeiro");
  const data = await loadBarberProject(query.barbearia, route.projectId);
  if (!data) redirect(`/barbeiro/projetos?barbearia=${encodeURIComponent(query.barbearia)}`);
  return <BarberShell context={data.context}><BarberProjectKanban data={data} /></BarberShell>;
}
