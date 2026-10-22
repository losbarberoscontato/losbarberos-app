import type { Metadata } from "next";
import { ConnectedSubscriptions } from "@/components/connected-client/subscriptions";
import { hasSupabaseConfig } from "@/lib/env";

export const metadata: Metadata = { title: "Detalhes do plano" };

export default async function CustomerPlanDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return hasSupabaseConfig ? <ConnectedSubscriptions view="my-plan" itemId={id} /> : <p>Os detalhes do plano ficarão disponíveis quando a conta estiver conectada.</p>;
}
