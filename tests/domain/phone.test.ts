import { describe, expect, it } from "vitest";
import { normalizePhoneE164 } from "@/lib/phone";

describe("normalizePhoneE164", () => {
  it("assume Brasil para telefone sem DDI", () => {
    expect(normalizePhoneE164("47999782545")).toBe("+5547999782545");
  });

  it("preserva DDI internacional informado", () => {
    expect(normalizePhoneE164("+351 912 345 678")).toBe("+351912345678");
  });

  it("aceita Brasil informado sem sinal de mais", () => {
    expect(normalizePhoneE164("5511999999999")).toBe("+5511999999999");
  });

  it("retorna nulo para entrada vazia ou inválida", () => {
    expect(normalizePhoneE164("")).toBeNull();
    expect(normalizePhoneE164("123")).toBeNull();
  });
});
