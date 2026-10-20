import { redirect } from "next/navigation";
import { AdminControlPlane } from "@/components/connected-admin/control-plane";
import { loadAdminControlPlaneData } from "@/components/connected-admin/server";
import { getAccessContext } from "@/lib/auth/context";

export default async function AdminPage() {
  const context = await getAccessContext();
  if (!context) redirect("/entrar?modo=login&next=%2Fadmin");
  if (context.role !== "PLATFORM_ADMIN") {
    if (context.role === "OWNER") redirect("/gestor");
    if (context.role === "CLIENT") redirect("/cliente/agendar");
    redirect("/onboarding");
  }

  const data = await loadAdminControlPlaneData();
  return <AdminControlPlane data={data} />;
}
