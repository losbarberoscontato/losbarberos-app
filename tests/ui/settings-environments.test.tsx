import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/connected-manager/settings-manager.tsx", "utf8");

describe("settings environments UI", () => {
  it("exposes add, order and active state controls", () => {
    expect(source).toContain("Ambientes da agenda");
    expect(source).toContain("Adicionar ambiente");
    expect(source).toContain("sort_order");
    expect(source).toContain("Ambiente inativado.");
  });

  it("surfaces legacy allocation issues to the manager", () => {
    expect(source).toContain("Pendências de alocação");
    expect(source).toContain("registro(s) legado(s)");
  });
});
