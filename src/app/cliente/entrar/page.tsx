import type { Metadata } from "next";
import { ClientAuthForm } from "@/components/connected-client/auth-form";
import { clientAuthDestination } from "@/lib/client-auth";

export const metadata: Metadata = { title: "Entrar" };

type ClientEntrySearchParams = Promise<{
  barbearia?: string | string[];
  booking?: string | string[];
  modo?: string | string[];
  next?: string | string[];
  oauth?: string | string[];
}>;

function singleValue(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function initialMode(value: string | string[] | undefined): "signin" | "signup" {
  return singleValue(value) === "cadastro" ? "signup" : "signin";
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
    booking: singleValue(input.booking),
  });
  const resolved = new URL(destination, "https://cliente.local");

  return (
    <ClientAuthForm
      initialNext={`${resolved.pathname}${resolved.search}`}
      initialSlug={resolved.searchParams.get("barbearia")}
      initialMode={initialMode(input.modo)}
      oauthCompletion={singleValue(input.oauth) === "complete"}
    />
  );
}
