import { describe, expect, it } from "vitest";
import {
  CATALOG_AUDIENCES,
  audienceLabel,
  filterByAudience,
  hasAudience,
} from "@/lib/catalog-audiences";

describe("públicos do catálogo", () => {
  it("expõe quatro públicos com labels de produto", () => {
    expect(CATALOG_AUDIENCES).toEqual([
      "INFANTIL",
      "FEMININO",
      "MASCULINO",
      "OUTROS_SERVICOS",
    ]);
    expect(audienceLabel("OUTROS_SERVICOS")).toBe("Outros Serviços");
  });

  it("exige ao menos um público", () => {
    expect(hasAudience([])).toBe(false);
    expect(hasAudience(["FEMININO"])).toBe(true);
  });

  it("filtra item quando público selecionado pertence à lista", () => {
    const items = [
      { audiences: ["INFANTIL"] as const, name: "Corte infantil" },
      { audiences: ["MASCULINO", "FEMININO"] as const, name: "Corte" },
      { audiences: [] as const, name: "Sem classificação" },
    ];
    expect(filterByAudience(items, "FEMININO").map((item) => item.name)).toEqual(["Corte"]);
  });
});
