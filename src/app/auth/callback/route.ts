import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { clientAuthDestination, clientOAuthCompletionDestination } from "@/lib/client-auth";
import { barberAuthDestination } from "@/lib/barber-auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { resolveSystemAuthDestination } from "@/lib/system-auth";
import { parseProductKey, setProductContextCookie } from "@/lib/product-context";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const requestedNextValues = url.searchParams.getAll("next");
  const requestedNext = requestedNextValues.length === 1 ? requestedNextValues[0] : "/gestor";
  const requestedSlugs = url.searchParams.getAll("barbearia");
  const requestedSlug = requestedSlugs.length === 1 ? requestedSlugs[0] : null;
  const requestedProviders = url.searchParams.getAll("provider");
  const requestedProducts = url.searchParams.getAll("produto");
  const requestedProduct = requestedProducts.length === 1 ? parseProductKey(requestedProducts[0]) : null;
  const selectedProduct = requestedProduct ?? "los-barberos";
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
    const params = new URLSearchParams({ erro: reason });
    if (requestedNextValues.length === 1) {
      params.set("modo", "login");
      params.set("next", destination);
    }
    const loginPath = requestedProduct === "le-gras" ? "/le-gras/entrar" : "/los-barberos/entrar";
    return NextResponse.redirect(new URL(`${loginPath}?${params.toString()}`, url.origin));
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    const params = new URLSearchParams({ erro: "oauth_exchange_failed" });
    if (requestedNextValues.length === 1) {
      params.set("modo", "login");
      params.set("next", destination);
    }
    const loginPath = requestedProduct === "le-gras" ? "/le-gras/entrar" : "/los-barberos/entrar";
    return NextResponse.redirect(new URL(`${loginPath}?${params.toString()}`, url.origin));
  }

  if (isGoogleFlow && isClientDestination) {
    const response = NextResponse.redirect(new URL(clientOAuthCompletionDestination({
      next: requestedNext,
      slug: requestedSlug,
    }), url.origin));
    setProductContextCookie(response, selectedProduct);
    return response;
  }

  if (requestedNext === "/onboarding" && requestedProducts.length <= 1) {
    const onboarding = new URL("/onboarding", url.origin);
    onboarding.searchParams.set("produto", selectedProduct);
    const response = NextResponse.redirect(onboarding);
    setProductContextCookie(response, selectedProduct);
    return response;
  }
  const response = NextResponse.redirect(new URL(destination, url.origin));
  setProductContextCookie(response, selectedProduct);
  return response;
}
