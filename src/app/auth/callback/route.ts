import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const allowedDestinations = new Set([
  "/gestor",
  "/onboarding",
  "/regularizacao",
  "/cliente/agendar",
  "/cliente/reservas",
  "/cliente/perfil",
  "/admin",
]);

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const requestedNext = url.searchParams.get("next") ?? "/gestor";
  const destination = allowedDestinations.has(requestedNext) ? requestedNext : "/gestor";
  const supabase = await getSupabaseServerClient();

  if (!code || !supabase) {
    const reason = !code ? "oauth_code_missing" : "supabase_not_configured";
    return NextResponse.redirect(new URL(`/entrar?erro=${reason}`, url.origin));
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL("/entrar?erro=oauth_exchange_failed", url.origin));
  }

  return NextResponse.redirect(new URL(destination, url.origin));
}
