import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseConfig, publicEnv } from "@/lib/env";

const publicWithoutSupabase = [
  "/",
  "/auth/callback",
  "/entrar",
  "/exclusao-de-dados",
  "/login",
  "/offline",
  "/privacidade",
  "/termos",
];

export function requiresSupabase(pathname: string): boolean {
  return !publicWithoutSupabase.includes(pathname);
}

export async function refreshSupabaseSession(request: NextRequest): Promise<NextResponse> {
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
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL!,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (entries) => {
          entries.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          entries.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );
  await supabase.auth.getClaims();
  return response;
}
