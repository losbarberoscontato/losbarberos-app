import type { Metadata } from "next";
import { ClientAuthForm } from "@/components/connected-client/auth-form";
import styles from "@/components/connected-client/connected-client.module.css";
import { clientAuthDestination } from "@/lib/client-auth";
import { clientEntryMetadata } from "@/lib/client-entry-metadata";


type ClientEntrySearchParams = Promise<{
  barbearia?: string | string[];
  booking?: string | string[];
  modo?: string | string[];
  next?: string | string[];
  oauth?: string | string[];
  complete?: string | string[];
  erro?: string | string[];
}>;

function singleValue(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function initialMode(value: string | string[] | undefined): "signin" | "signup" {
  return singleValue(value) === "cadastro" ? "signup" : "signin";
}

export async function generateMetadata({ searchParams }: { searchParams: ClientEntrySearchParams }): Promise<Metadata> {
  const input = await searchParams;
  return clientEntryMetadata({
    next: singleValue(input.next),
    slug: singleValue(input.barbearia),
    booking: singleValue(input.booking),
  });
}

export default async function ClientEntryPage({
  searchParams,
}: {
  searchParams: ClientEntrySearchParams;
}) {
  const input = await searchParams;
  if (input.erro === "invalid_client_context") {
    return <section className={styles.authForm} role="alert">Link de acesso inválido. Solicite um novo link ao estabelecimento.</section>;
  }
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
      resumeCompletion={singleValue(input.complete) === "1"}
    />
  );
}
