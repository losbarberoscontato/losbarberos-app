import { redirect } from "next/navigation";
import { BarberConnectionScreen, BarberDisconnectedScreen } from "@/components/connected-barber/access";
import { barberLoginHref } from "@/lib/barber-auth";
import { getBarberAccessState } from "@/lib/barber-server";

export default async function BarberHomePage() {
  const access = await getBarberAccessState();
  if (!access) redirect(barberLoginHref("/barbeiro"));
  if (!access.organizations.length) return <BarberDisconnectedScreen profile={access.profile} email={access.email} />;
  if (access.organizations.length === 1) redirect(`/barbeiro/agenda?barbearia=${encodeURIComponent(access.organizations[0].organization_slug)}`);
  return <BarberConnectionScreen organizations={access.organizations} />;
}
