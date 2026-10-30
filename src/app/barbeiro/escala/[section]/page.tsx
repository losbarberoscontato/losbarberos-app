import { notFound, redirect } from "next/navigation";
import { BarberDisconnectedScreen } from "@/components/connected-barber/access";
import { BarberSchedule, type ScheduleSection } from "@/components/connected-barber/schedule";
import { BarberShell } from "@/components/connected-barber/barber-shell";
import { getBarberAccessState, getBarberAppContext } from "@/lib/barber-server";
import { barberLoginHref } from "@/lib/barber-auth";

const sections = new Set<ScheduleSection>(["folgas", "historico", "nova-folga"]);

export default async function BarberScheduleSectionPage({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<{ barbearia?: string }> }) {
  const [{ section }, query] = await Promise.all([params, searchParams]);
  if (!sections.has(section as ScheduleSection)) notFound();
  const access = await getBarberAccessState();
  if (!access) redirect(barberLoginHref(`/barbeiro/escala/${section}`, query.barbearia));
  if (!access.organizations.length) return <BarberDisconnectedScreen profile={access.profile} email={access.email} />;
  if (!query.barbearia) {
    if (access.organizations.length === 1) redirect(`/barbeiro/escala/${section}?barbearia=${encodeURIComponent(access.organizations[0].organization_slug)}`);
    redirect("/barbeiro");
  }
  const context = await getBarberAppContext(query.barbearia);
  if (!context) redirect("/barbeiro");
  return <BarberShell context={context}><BarberSchedule context={context} section={section as ScheduleSection} /></BarberShell>;
}
