import { describe, expect, it } from "vitest";
import { barberAuthDestination, barberLoginHref } from "@/lib/barber-auth";

describe("barberAuthDestination", () => {
  it("accepts only internal barber destinations and normalized tenant context", () => {
    expect(barberAuthDestination({ next: "/barbeiro/caixa", slug: "Barbearia-Central" })).toBe("/barbeiro/caixa?barbearia=barbearia-central");
    expect(barberAuthDestination({ next: "https://evil.example", slug: "central" })).toBe("/barbeiro?barbearia=central");
  });

  it("builds a login URL without leaking external next values", () => {
    expect(barberLoginHref("//evil.example", "Central")).toBe("/barbeiro/entrar?next=%2Fbarbeiro&barbearia=central");
  });
});
