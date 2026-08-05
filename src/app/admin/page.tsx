import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminDashboard } from "@/components/admin-dashboard";
import { AdminControlPlane } from "@/components/connected-admin/control-plane";
import { loadAdminControlPlaneData } from "@/components/connected-admin/server";
import { getAccessContext } from "@/lib/auth/context";
import { hasSupabaseConfig } from "@/lib/env";

export const metadata: Metadata = { title: "Platform admin" };

export default async function AdminPage() {
  const context = hasSupabaseConfig ? await getAccessContext() : null;

  if (hasSupabaseConfig && !context) redirect("/entrar?next=/admin");
  if (context && context.role !== "PLATFORM_ADMIN") {
    redirect(context.role === "OWNER" ? "/gestor" : "/cliente/agendar");
  }

  if (hasSupabaseConfig) return <AdminControlPlane data={await loadAdminControlPlaneData()} />;

  return <AdminDashboard demoMode />;
}
