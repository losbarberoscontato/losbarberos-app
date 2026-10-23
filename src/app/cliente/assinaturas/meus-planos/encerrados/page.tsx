import { ConnectedSubscriptions } from "@/components/connected-client/subscriptions";
import { hasSupabaseConfig } from "@/lib/env";

export default function ClosedCustomerPlansPage() {
  return hasSupabaseConfig ? <ConnectedSubscriptions view="closed-plans" /> : <p>Planos Encerrados ficará disponível quando a conta estiver conectada.</p>;
}
