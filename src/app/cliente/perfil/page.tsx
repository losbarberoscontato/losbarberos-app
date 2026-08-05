import type { Metadata } from "next";
import { CustomerProfile } from "@/components/customer-profile";
import { ConnectedProfile } from "@/components/connected-client/profile";
import { hasSupabaseConfig } from "@/lib/env";

export const metadata: Metadata = { title: "Perfil" };

export default function CustomerProfilePage() {
  if (hasSupabaseConfig) return <ConnectedProfile />;
  return <div className="customer-profile-page"><CustomerProfile /></div>;
}
