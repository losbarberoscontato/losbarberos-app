import type { Metadata } from "next";
import { getPublicClientEntryContext } from "@/components/connected-client/api";
import { clientAuthDestination } from "@/lib/client-auth";
import { getPublishedProductIdentity } from "@/lib/product-identity-server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const neutralMetadata: Metadata = {
  title: { absolute: "Entrar · Display SH" },
  icons: { icon: "/display-sh/icon.svg" },
};

export async function clientEntryMetadata(input: {
  next?: string | null;
  slug?: string | null;
  booking?: string | null;
}): Promise<Metadata> {
  const destination = new URL(clientAuthDestination(input), "https://cliente.local");
  const booking = destination.searchParams.get("booking");
  const slug = destination.searchParams.get("barbearia");
  if (!booking && !slug) return neutralMetadata;
  const supabase = await getSupabaseServerClient();
  if (!supabase) return neutralMetadata;
  try {
    const entry = await getPublicClientEntryContext(supabase, { booking, slug });
    if (!entry?.product_key) return neutralMetadata;
    const identity = await getPublishedProductIdentity(entry.product_key);
    const name = identity?.brand.name ?? (entry.product_key === "los-barberos" ? "Los Barberos" : "Display SH");
    return {
      title: { absolute: `Entrar · ${name}` },
      icons: { icon: identity?.brand.logoUrl ?? (entry.product_key === "los-barberos" ? "/icon.svg" : "/display-sh/icon.svg") },
    };
  } catch {
    return neutralMetadata;
  }
}
