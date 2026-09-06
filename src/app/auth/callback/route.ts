import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { clientAuthDestination, clientOAuthCompletionDestination } from "@/lib/client-auth";
import { barberAuthDestination } from "@/lib/barber-auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { resolveSystemAuthDestination } from "@/lib/system-auth";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const requestedNextValues = url.searchParams.getAll("next");
  const requestedNext = requestedNextValues.length === 1 ? requestedNextValues[0] : "/gestor";
  const requestedSlugs = url.searchParams.getAll("barbearia");
  const requestedSlug = requestedSlugs.length === 1 ? requestedSlugs[0] : null;
  const requestedProviders = url.searchParams.getAll("provider");
  const isGoogleFlow = requestedProviders.length === 1 && requestedProviders[0] === "google";
  const isClientDestination = requestedNextValues.length === 1
    && (requestedNext === "/cliente" || requestedNext.startsWith("/cliente/"));
  const isBarberDestination = requestedNextValues.length === 1
    && (requestedNext === "/barbeiro" || requestedNext.startsWith("/barbeiro/"));
  const destination = requestedNextValues.length !== 1
    ? "/gestor"
    : isClientDestination
    ? clientAuthDestination({
      next: requestedNext,
      slug: requestedSlug,
    })
    : isBarberDestination
    ? barberAuthDestination({ next: requestedNext, slug: requestedSlug })
    : resolveSystemAuthDestination(requestedNext);
  const supabase = await getSupabaseServerClient();

  if (!code || !supabase) {
    const reason = !code ? "oauth_code_missing" : "supabase_not_configured";
    return NextResponse.redirect(new URL(`/entrar?erro=${reason}`, url.origin));
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL("/entrar?erro=oauth_exchange_failed", url.origin));
  }

  if (isGoogleFlow && isClientDestination) {
    return NextResponse.redirect(new URL(clientOAuthCompletionDestination({
      next: requestedNext,
      slug: requestedSlug,
    }), url.origin));
  }

  return NextResponse.redirect(new URL(destination, url.origin));
}
