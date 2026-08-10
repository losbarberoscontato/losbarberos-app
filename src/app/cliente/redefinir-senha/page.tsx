import type { Metadata } from "next";
import { ClientPasswordResetForm } from "@/components/connected-client/auth-form";
import { clientAuthDestination } from "@/lib/client-auth";

export const metadata: Metadata = { title: "Redefinir senha" };

type PasswordResetSearchParams = Promise<{
  barbearia?: string | string[];
}>;

export default async function ClientPasswordResetPage({
  searchParams,
}: {
  searchParams: PasswordResetSearchParams;
}) {
  const input = await searchParams;
  const slug = typeof input.barbearia === "string" ? input.barbearia : null;
  const destination = clientAuthDestination({ next: "/cliente", slug });
  const resolved = new URL(destination, "https://cliente.local");

  return <ClientPasswordResetForm initialSlug={resolved.searchParams.get("barbearia")} />;
}
