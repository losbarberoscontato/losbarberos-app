import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasSupabaseConfig, publicEnv } from "@/lib/env";

// React cache is scoped to one server render, including its cookies/session.
// Never replace this with a process-wide or persistent data cache.
export const getSupabaseServerClient = cache(async (): Promise<SupabaseClient | null> => {
  if (!hasSupabaseConfig) return null;
  const cookieStore = await cookies();

  return createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL!,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (entries) => {
          try {
            entries.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Server Components cannot set cookies. Proxy refreshes sessions.
          }
        },
      },
    },
  );
});

