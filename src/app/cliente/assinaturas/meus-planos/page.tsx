import { ConnectedSubscriptions } from "@/components/connected-client/subscriptions";
import { hasSupabaseConfig } from "@/lib/env";

export default function CustomerPlansPage() {
  return hasSupabaseConfig ? <ConnectedSubscriptions view="my-plans" /> : <p>Meus Planos ficará disponível quando a conta estiver conectada.</p>;
}
