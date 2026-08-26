import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  hasSupabaseConfig: true,
  publicEnv: {
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
  },
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getClaims: mocks.getClaims } }),
}));

import { refreshSupabaseSession } from "@/lib/supabase/proxy";

describe("proxy com Supabase configurado", () => {
  it("mantém refresh de sessão nas rotas conectadas", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: null }, error: null });

    const response = await refreshSupabaseSession(
      new NextRequest("http://localhost:3000/gestor"),
    );

    expect(mocks.getClaims).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });
});
