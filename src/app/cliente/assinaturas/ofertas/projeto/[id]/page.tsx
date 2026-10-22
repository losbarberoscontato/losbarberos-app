import { ConnectedSubscriptions } from "@/components/connected-client/subscriptions";
import { hasSupabaseConfig } from "@/lib/env";

export default async function ProjectOfferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return hasSupabaseConfig ? <ConnectedSubscriptions view="project-offer" itemId={id} /> : <p>Oferta ficará disponível quando a conta estiver conectada.</p>;
}
