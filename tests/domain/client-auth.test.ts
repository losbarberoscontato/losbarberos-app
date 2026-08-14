import { describe, expect, it } from "vitest";
import { clientAuthDestination, clientSignupSchema } from "@/lib/client-auth";

describe("clientAuthDestination", () => {
  it.each([
    ["/cliente", "/cliente?barbearia=barbearia-real"],
    ["/cliente/agendar", "/cliente/agendar?barbearia=barbearia-real"],
    ["/cliente/reservas", "/cliente/reservas?barbearia=barbearia-real"],
    ["/cliente/perfil", "/cliente/perfil?barbearia=barbearia-real"],
  ])("keeps allowed client path %s with normalized tenant context", (next, expected) => {
    expect(clientAuthDestination({ next, slug: " Barbearia-Real " })).toBe(expected);
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/cliente\\evil",
    "/cliente%5Cevil",
    "/cliente/%2e%2e/gestor",
    "/cliente?barbearia=other",
    "/cliente?barbearia=barbearia-real&barbearia=other",
    "/cliente#unsafe",
    "/cliente/redefinir-senha",
    "/gestor",
  ])("rejects unsafe or non-allowlisted next %s", (next) => {
    expect(clientAuthDestination({ next, slug: "barbearia-real" })).toBe(
      "/cliente?barbearia=barbearia-real",
    );
  });

  it("drops invalid tenant context", () => {
    expect(clientAuthDestination({ next: "/cliente/agendar", slug: "barbearia/evil" })).toBe(
      "/cliente/agendar",
    );
  });

  it("preserves only validated walk-in booking context after authentication", () => {
    expect(clientAuthDestination({
      next: "/cliente/agendar?barbeiro=00000000-0000-4000-8000-000000000002&horario=2026-08-11T13%3A15%3A00.000Z&admin=true",
      slug: "barbearia-real",
    })).toBe(
      "/cliente/agendar?barbearia=barbearia-real&barbeiro=00000000-0000-4000-8000-000000000002&horario=2026-08-11T13%3A15%3A00.000Z",
    );
  });
});

describe("clientSignupSchema", () => {
  it("normalizes valid client signup fields", () => {
    const result = clientSignupSchema.safeParse({
      fullName: "  Ana Souza  ",
      phoneE164: "+5511999999999",
      email: " ANA@EXAMPLE.COM ",
      password: "Senha#123",
      birthDate: "1990-02-10",
      acceptedTerms: true,
    });

    expect(result).toMatchObject({
      success: true,
      data: {
        fullName: "Ana Souza",
        phoneE164: "+5511999999999",
        email: "ana@example.com",
        birthDate: "1990-02-10",
        acceptedTerms: true,
      },
    });
  });

  it.each([
    ["fullName", " A "],
    ["fullName", "A".repeat(161)],
    ["phoneE164", "5511999999999"],
    ["phoneE164", "+5512345"],
    ["email", "ana-at-example.com"],
    ["password", "Senha123"],
    ["birthDate", "1990-02-30"],
    ["acceptedTerms", false],
  ])("rejects invalid signup %s", (field, value) => {
    const result = clientSignupSchema.safeParse({
      fullName: "Ana Souza",
      phoneE164: "+5511999999999",
      email: "ana@example.com",
      password: "Senha#123",
      birthDate: "1990-02-10",
      acceptedTerms: true,
      [field]: value,
    });

    expect(result.success).toBe(false);
  });
});
