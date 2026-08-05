import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ManagerShell } from "@/components/manager-shell";
import { getAccessContext } from "@/lib/auth/context";
import { hasSupabaseConfig } from "@/lib/env";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Painel do gestor" };

export default async function GestorLayout({ children }: { children: React.ReactNode }) {
  const context = hasSupabaseConfig ? await getAccessContext() : null;

  if (hasSupabaseConfig && !context) redirect("/entrar?next=/gestor");
  if (context?.role === "PLATFORM_ADMIN") redirect("/admin");
  if (context?.role === "CLIENT") redirect("/cliente/agendar");
  if (context?.billingStatus === "PROVISIONING") redirect("/onboarding");
  // Pages keep canceled tenants out of the operation. Configurações remains
  // reachable so CANCELED_RETENTION can export data; CLOSED sees it disabled.

  let organizationName = "Sua barbearia";
  let locationName = "Unidade principal";
  let userName = "Gestor";
  if (context?.organizationId) {
    const supabase = await getSupabaseServerClient();
    if (supabase) {
      const [{ data: organization }, { data: location }, { data: profile }] = await Promise.all([
        supabase.from("organizations").select("name").eq("id", context.organizationId).maybeSingle(),
        supabase.from("locations").select("name").eq("organization_id", context.organizationId).eq("active", true).maybeSingle(),
        supabase.from("profiles").select("display_name").eq("id", context.userId).maybeSingle(),
      ]);
      organizationName = organization?.name ?? organizationName;
      locationName = location?.name ?? locationName;
      userName = profile?.display_name ?? userName;
    }
  }

  return (
    <ManagerShell demoMode={!hasSupabaseConfig} billingBlocked={context?.billingStatus === "BLOCKED"} organizationName={hasSupabaseConfig ? organizationName : "Los Barberos"} locationName={hasSupabaseConfig ? locationName : "Vila Madalena"} userName={hasSupabaseConfig ? userName : "Guilherme Castro"}>
      {children}
    </ManagerShell>
  );
}
