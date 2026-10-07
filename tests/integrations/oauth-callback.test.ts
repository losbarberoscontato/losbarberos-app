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
      "/cliente/agendar?barbearia=barbearia-real",
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

  it("routes Google client access through required profile completion", async () => {
    exchangeCodeForSession.mockResolvedValueOnce({ error: null });

    const response = await GET(
      new Request(
        "https://app.example/auth/callback?code=code&next=%2Fcliente%2Fagendar&barbearia=Barbearia-Real&provider=google",
      ) as NextRequest,
    );

    expect(response.headers.get("location")).toBe(
      "https://app.example/cliente/entrar?oauth=complete&next=%2Fcliente%2Fagendar&barbearia=barbearia-real",
    );
  });

  it("keeps a public booking link in the client flow after Google login", async () => {
    exchangeCodeForSession.mockResolvedValueOnce({ error: null });
    const response = await GET(new Request(
      "https://app.example/auth/callback?code=code&next=%2Fcliente%3Fbooking%3D4039018f-5f6c-4359-ac66-ab17a04ba161&provider=google",
    ) as NextRequest);

    expect(response.headers.get("location")).toBe(
      "https://app.example/cliente/entrar?oauth=complete&next=%2Fcliente%3Fbooking%3D4039018f-5f6c-4359-ac66-ab17a04ba161",
    );
  });

  it("preserves validated booking context through Google profile completion", async () => {
    exchangeCodeForSession.mockResolvedValueOnce({ error: null });
    const next = "/cliente/agendar?barbeiro=00000000-0000-4000-8000-000000000002&horario=2026-08-11T13%3A15%3A00.000Z";
    const url = new URL("https://app.example/auth/callback");
    url.searchParams.set("code", "code");
    url.searchParams.set("next", next);
    url.searchParams.set("barbearia", "barbearia-real");
    url.searchParams.set("provider", "google");

    const response = await GET(new Request(url) as NextRequest);

    expect(response.headers.get("location")).toBe(
      "https://app.example/cliente/entrar?oauth=complete&next=%2Fcliente%2Fagendar%3Fbarbeiro%3D00000000-0000-4000-8000-000000000002%26horario%3D2026-08-11T13%253A15%253A00.000Z&barbearia=barbearia-real",
    );
  });

  it("ignores duplicated provider context", async () => {
    exchangeCodeForSession.mockResolvedValueOnce({ error: null });
    const url = new URL("https://app.example/auth/callback");
    url.searchParams.set("code", "code");
    url.searchParams.set("next", "/cliente/agendar");
    url.searchParams.append("provider", "google");
    url.searchParams.append("provider", "google");

    const response = await GET(new Request(url) as NextRequest);

    expect(response.headers.get("location")).toBe("https://app.example/cliente/agendar");
  });

  it("does not admit the password reset screen through the server callback", async () => {
    exchangeCodeForSession.mockResolvedValueOnce({ error: null });

    const response = await GET(
      new Request(
        "https://app.example/auth/callback?code=recovery-code&next=%2Fcliente%2Fredefinir-senha&barbearia=Barbearia-Real",
      ) as NextRequest,
    );

    expect(exchangeCodeForSession).toHaveBeenCalledWith("recovery-code");
    expect(response.headers.get("location")).toBe(
      "https://app.example/cliente/agendar?barbearia=barbearia-real",
    );
  });

  it.each([
    ["Barbearia-Real", "Barbearia-Real"],
    ["barbearia-real", "outra-barbearia"],
  ])("rejects duplicated client tenant context %s and %s", async (firstSlug, secondSlug) => {

    const url = new URL("https://app.example/auth/callback");
    url.searchParams.set("code", "code");
    url.searchParams.set("next", "/cliente/agendar");
    url.searchParams.append("barbearia", firstSlug);
    url.searchParams.append("barbearia", secondSlug);

    const response = await GET(new Request(url) as NextRequest);

    expect(response.headers.get("location")).toBe("https://app.example/cliente/entrar?erro=invalid_client_context");
  });

  it("keeps a client callback out of manager onboarding when next is missing", async () => {
    const response = await GET(
      new Request(
        "https://app.example/auth/callback?code=code&barbearia=barbearia-real",
      ) as NextRequest,
    );

    expect(response.headers.get("location")).toBe("https://app.example/cliente/entrar?erro=invalid_client_context");
  });

  it("keeps a client callback out of manager onboarding when next is duplicated", async () => {
    const response = await GET(
      new Request(
        "https://app.example/auth/callback?code=code&next=%2Fcliente%2Fagendar&next=%2Fdisplay-admin&barbearia=barbearia-real",
      ) as NextRequest,
    );

    expect(response.headers.get("location")).toBe("https://app.example/cliente/entrar?erro=invalid_client_context");
  });

  it("keeps manager and admin callback destinations constrained", async () => {
    exchangeCodeForSession.mockResolvedValueOnce({ error: null });
    const admin = await GET(
      new Request("https://app.example/auth/callback?code=code&next=%2Fdisplay-admin") as NextRequest,
    );

    exchangeCodeForSession.mockResolvedValueOnce({ error: null });
    const unsafe = await GET(
      new Request("https://app.example/auth/callback?code=code&next=https%3A%2F%2Fevil.example") as NextRequest,
    );

    expect(admin.headers.get("location")).toBe("https://app.example/display-admin");
    expect(unsafe.headers.get("location")).toBe("https://app.example/gestor");
  });
});
