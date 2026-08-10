import type { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { clientAuthDestination } from "@/lib/client-auth";
import { normalizeSafeReturnPath } from "@/lib/integrations/state";

const { exchangeCodeForSession } = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: async () => ({
    auth: { exchangeCodeForSession },
  }),
}));

import { GET } from "@/app/auth/callback/route";

describe("OAuth callback return path", () => {
  it("keeps local paths and rejects open redirects", () => {
    expect(normalizeSafeReturnPath("/gestor/agenda?dia=hoje", "/gestor")).toBe(
      "/gestor/agenda?dia=hoje",
    );
    expect(normalizeSafeReturnPath("//evil.example", "/gestor")).toBe("/gestor");
    expect(normalizeSafeReturnPath("https://evil.example", "/gestor")).toBe("/gestor");
    expect(normalizeSafeReturnPath("/gestor\\evil", "/gestor")).toBe("/gestor");
  });

  it("uses client destination allowlist instead of arbitrary callback next", () => {
    expect(clientAuthDestination({ next: "/cliente/agendar", slug: "barbearia-real" })).toBe(
      "/cliente/agendar?barbearia=barbearia-real",
    );
    expect(clientAuthDestination({ next: "https://evil.example", slug: "barbearia-real" })).toBe(
      "/cliente?barbearia=barbearia-real",
    );
  });

  it("preserves normalized client tenant context after code exchange", async () => {
    exchangeCodeForSession.mockResolvedValueOnce({ error: null });

    const response = await GET(
      new Request(
        "https://app.example/auth/callback?code=code&next=%2Fcliente%2Fagendar&barbearia=Barbearia-Real",
      ) as NextRequest,
    );

    expect(response.headers.get("location")).toBe(
      "https://app.example/cliente/agendar?barbearia=barbearia-real",
    );
  });

  it("keeps manager and admin callback destinations constrained", async () => {
    exchangeCodeForSession.mockResolvedValueOnce({ error: null });
    const admin = await GET(
      new Request("https://app.example/auth/callback?code=code&next=%2Fadmin") as NextRequest,
    );

    exchangeCodeForSession.mockResolvedValueOnce({ error: null });
    const unsafe = await GET(
      new Request("https://app.example/auth/callback?code=code&next=https%3A%2F%2Fevil.example") as NextRequest,
    );

    expect(admin.headers.get("location")).toBe("https://app.example/admin");
    expect(unsafe.headers.get("location")).toBe("https://app.example/gestor");
  });
});
