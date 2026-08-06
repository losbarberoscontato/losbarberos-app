import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ManagerShell } from "@/components/manager-shell";
import { getAccessContext } from "@/lib/auth/context";
import { hasSupabaseConfig } from "@/lib/env";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { appointments as demoAppointments } from "@/data/demo";

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
  let agendaCount = demoAppointments.filter((appointment) => appointment.date === new Intl.DateTimeFormat("en-CA").format(new Date())).length;
  if (context?.organizationId) {
    const supabase = await getSupabaseServerClient();
    if (supabase) {
      const [{ data: organization }, { data: location }, { data: profile }] = await Promise.all([
        supabase.from("organizations").select("name,timezone").eq("id", context.organizationId).maybeSingle(),
        supabase.from("locations").select("name").eq("organization_id", context.organizationId).eq("active", true).maybeSingle(),
        supabase.from("profiles").select("display_name").eq("id", context.userId).maybeSingle(),
      ]);
      organizationName = organization?.name ?? organizationName;
      locationName = location?.name ?? locationName;
      userName = profile?.display_name ?? userName;
      const { data: todayAppointments } = await supabase.from("appointments").select("service_period,status").eq("organization_id", context.organizationId);
      const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: (organization as { timezone?: string } | null)?.timezone ?? "UTC" }).format(new Date());
      agendaCount = (todayAppointments ?? []).filter((appointment) => {
        if (["CANCELED", "NO_SHOW", "EXPIRED"].includes(appointment.status)) return false;
        const start = String(appointment.service_period).match(/\[([^,]+)/)?.[1];
        return start ? new Intl.DateTimeFormat("en-CA", { timeZone: (organization as { timezone?: string } | null)?.timezone ?? "UTC" }).format(new Date(start)) === todayKey : false;
      }).length;
    }
  }

  return (
    <ManagerShell agendaCount={agendaCount} demoMode={!hasSupabaseConfig} billingBlocked={context?.billingStatus === "BLOCKED"} organizationName={hasSupabaseConfig ? organizationName : "Los Barberos"} locationName={hasSupabaseConfig ? locationName : "Vila Madalena"} userName={hasSupabaseConfig ? userName : "Guilherme Castro"}>
      {children}
    </ManagerShell>
  );
}
