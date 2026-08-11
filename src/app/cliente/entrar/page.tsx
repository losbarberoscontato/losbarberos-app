import type { Metadata } from "next";
import { ClientAuthForm } from "@/components/connected-client/auth-form";
import { clientAuthDestination } from "@/lib/client-auth";

export const metadata: Metadata = { title: "Entrar" };

type ClientEntrySearchParams = Promise<{
  barbearia?: string | string[];
  next?: string | string[];
}>;

function singleValue(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

export default async function ClientEntryPage({
  searchParams,
}: {
  searchParams: ClientEntrySearchParams;
}) {
  const input = await searchParams;
  const destination = clientAuthDestination({
    next: singleValue(input.next),
    slug: singleValue(input.barbearia),
  });
  const resolved = new URL(destination, "https://cliente.local");

  return (
    <ClientAuthForm
      initialNext={resolved.pathname}
      initialSlug={resolved.searchParams.get("barbearia")}
    />
  );
}
