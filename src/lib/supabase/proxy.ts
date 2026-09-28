import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseConfig, publicEnv } from "@/lib/env";

const publicWithoutSupabase = [
  "/",
  "/auth/callback",
  "/barbeiro/entrar",
  "/entrar",
  "/exclusao-de-dados",
  "/login",
  "/offline",
  "/privacidade",
  "/termos",
];

const publicProductRoutes = [
  "/los-barberos",
  "/los-barberos/entrar",
  "/le-gras",
  "/le-gras/entrar",
  "/pro-stetic",
  "/pro-stetic/entrar",
  "/music-pro",
  "/music-pro/entrar",
];

export function requiresSupabase(pathname: string): boolean {
  return !publicWithoutSupabase.includes(pathname) && !publicProductRoutes.includes(pathname);
}

export async function refreshSupabaseSession(
  request: NextRequest,
  rewritePath?: string,
): Promise<NextResponse> {
  const nextResponse = () =>
    rewritePath
      ? NextResponse.rewrite(new URL(rewritePath, request.url), { request })
      : NextResponse.next({ request });

  if (!hasSupabaseConfig) {
    if (requiresSupabase(request.nextUrl.pathname)) {
      const loginUrl = new URL("/entrar", request.url);
      loginUrl.searchParams.set("erro", "supabase_not_configured");
      loginUrl.searchParams.set(
        "next",
        `${request.nextUrl.pathname}${request.nextUrl.search}`,
      );
      return NextResponse.redirect(loginUrl);
    }
    return nextResponse();
  }

  let response = nextResponse();
  const supabase = createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL!,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (entries) => {
          entries.forEach(({ name, value }) => request.cookies.set(name, value));
          response = nextResponse();
          entries.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );
  await supabase.auth.getClaims();
  return response;
}
