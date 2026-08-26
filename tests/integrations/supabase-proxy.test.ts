import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/env", () => ({
  hasSupabaseConfig: false,
  publicEnv: {},
}));

import {
  refreshSupabaseSession,
  requiresSupabase,
} from "@/lib/supabase/proxy";

describe("Supabase obrigatório", () => {
  it.each([
    "/gestor",
    "/gestor/agenda",
    "/cliente/agendar",
    "/admin",
    "/onboarding",
    "/regularizacao",
    "/b/barbearia-central",
    "/fila/queue-id",
  ])("classifica %s como rota conectada", (pathname) => {
    expect(requiresSupabase(pathname)).toBe(true);
  });

  it.each([
    "/",
    "/auth/callback",
    "/entrar",
    "/exclusao-de-dados",
    "/login",
    "/offline",
    "/privacidade",
    "/termos",
  ])(
    "mantém %s pública",
    (pathname) => {
      expect(requiresSupabase(pathname)).toBe(false);
    },
  );

  it("bloqueia por padrão uma rota operacional futura", () => {
    expect(requiresSupabase("/nova-area-operacional")).toBe(true);
  });

  it("redireciona rota conectada sem ativar Demo", async () => {
    const response = await refreshSupabaseSession(
      new NextRequest("http://localhost:3000/gestor/agenda?dia=hoje"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/entrar?erro=supabase_not_configured&next=%2Fgestor%2Fagenda%3Fdia%3Dhoje",
    );
  });

  it("mantém hotsite acessível sem Supabase", async () => {
    const response = await refreshSupabaseSession(
      new NextRequest("http://localhost:3000/"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });
});
