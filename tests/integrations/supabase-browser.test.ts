import { describe, expect, it, vi } from "vitest";

const { createBrowserClient } = vi.hoisted(() => ({
  createBrowserClient: vi.fn(() => ({ auth: {} })),
}));

vi.mock("@supabase/ssr", () => ({ createBrowserClient }));
vi.mock("@/lib/env", () => ({
  hasSupabaseConfig: true,
  publicEnv: {
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
  },
}));

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

describe("getSupabaseBrowserClient", () => {
  it("uses explicit PKCE exchange and appends flow context to redirects", () => {
    expect(getSupabaseBrowserClient()).not.toBeNull();
    expect(createBrowserClient).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "publishable-key",
      {
        auth: {
          detectSessionInUrl: false,
          experimental: { appendPkceFlowIdToRedirects: true },
        },
      },
    );
  });
});
