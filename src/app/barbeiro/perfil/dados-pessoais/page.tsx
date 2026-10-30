import { redirect } from "next/navigation";
import { BarberDisconnectedScreen } from "@/components/connected-barber/access";
import { BarberPersonalData } from "@/components/connected-barber/profile";
import { BarberShell } from "@/components/connected-barber/barber-shell";
import { getBarberAccessState, getBarberAppContext } from "@/lib/barber-server";
import { barberLoginHref } from "@/lib/barber-auth";

export default async function BarberPersonalDataPage({ searchParams }: { searchParams: Promise<{ barbearia?: string }> }) {
  const params = await searchParams;
  const access = await getBarberAccessState();
  if (!access) redirect(barberLoginHref("/barbeiro/perfil/dados-pessoais", params.barbearia));
  if (!access.organizations.length) return <BarberDisconnectedScreen profile={access.profile} email={access.email} />;
  if (!params.barbearia) {
    if (access.organizations.length === 1) redirect(`/barbeiro/perfil/dados-pessoais?barbearia=${encodeURIComponent(access.organizations[0].organization_slug)}`);
    redirect("/barbeiro");
  }
  const context = await getBarberAppContext(params.barbearia);
  if (!context) redirect("/barbeiro");
  return <BarberShell context={context}><BarberPersonalData context={context} /></BarberShell>;
}
