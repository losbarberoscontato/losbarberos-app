import { redirect } from "next/navigation";
import { ConnectedClientHome } from "@/components/connected-client/home";
import { hasSupabaseConfig } from "@/lib/env";

export default function CustomerHomePage() {
  if (hasSupabaseConfig) return <ConnectedClientHome />;
  redirect("/cliente/agendar");
}

