"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasSupabaseConfig, publicEnv } from "@/lib/env";

let client: SupabaseClient | null | undefined;

export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  if (!hasSupabaseConfig) {
    client = null;
    return client;
  }
  client = createBrowserClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL!,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: {
        detectSessionInUrl: false,
        experimental: { appendPkceFlowIdToRedirects: true },
      },
    },
  );
  return client;
}

