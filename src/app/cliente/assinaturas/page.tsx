import type { Metadata } from "next";
import { ConnectedSubscriptions } from "@/components/connected-client/subscriptions";
import { hasSupabaseConfig } from "@/lib/env";

export const metadata: Metadata = { title: "Meus planos" };

export default function CustomerSubscriptionsPage() {
  if (!hasSupabaseConfig) return <p>Minhas assinaturas ficará disponível quando a conta estiver conectada.</p>;
  return <ConnectedSubscriptions />;
}
