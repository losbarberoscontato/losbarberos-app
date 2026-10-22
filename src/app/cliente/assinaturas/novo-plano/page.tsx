import { ConnectedSubscriptions } from "@/components/connected-client/subscriptions";
import { hasSupabaseConfig } from "@/lib/env";

export default function NewCustomerPlanPage() {
  return hasSupabaseConfig ? <ConnectedSubscriptions view="new-plan" /> : <p>Novo Plano ficará disponível quando a conta estiver conectada.</p>;
}
