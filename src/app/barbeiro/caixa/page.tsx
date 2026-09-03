import { redirect } from "next/navigation";
import { BarberCash } from "@/components/connected-barber/cash";
import { BarberShell } from "@/components/connected-barber/barber-shell";
import { loadBarberCash } from "@/lib/barber-server";

export default async function BarberCashPage({ searchParams }: { searchParams: Promise<{ barbearia?: string }> }) {
  const params = await searchParams;
  if (!params.barbearia) redirect("/barbeiro");
  const data = await loadBarberCash(params.barbearia);
  if (!data) redirect("/barbeiro");
  return <BarberShell context={data.context}><BarberCash {...data} /></BarberShell>;
}
