import { ConnectedSubscriptions } from "@/components/connected-client/subscriptions";
import { hasSupabaseConfig } from "@/lib/env";

export default async function ProjectPlanDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return hasSupabaseConfig ? <ConnectedSubscriptions view="project" itemId={id} /> : <p>Detalhes do plano ficarão disponíveis quando a conta estiver conectada.</p>;
}
