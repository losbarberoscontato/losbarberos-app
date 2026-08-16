import { describe, expect, it } from "vitest";
import { formatBirthDateInput, normalizeBirthDateInput, parseBirthDateInput } from "@/lib/birth-date";

describe("data de nascimento no cliente", () => {
  it("formata e valida DD/MM/AAAA sem abrir seletor de calendário", () => {
    expect(formatBirthDateInput("1990-02-10")).toBe("10/02/1990");
    expect(normalizeBirthDateInput("10021990")).toBe("10/02/1990");
    expect(parseBirthDateInput("10/02/1990")).toBe("1990-02-10");
  });

  it("rejeita datas impossíveis", () => {
    expect(parseBirthDateInput("31/02/1990")).toBeNull();
  });
});
