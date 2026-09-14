import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/connected-manager/team-manager.tsx", "utf8");

describe("team schedule environment controls", () => {
  it("requires an available environment before adding a work interval", () => {
    expect(source).toContain('name="environment_id" required');
    expect(source).toContain("Nenhum ambiente livre para esta faixa.");
    expect(source).toContain("environment_id: environmentId");
  });

  it("only asks for environment on available exceptions", () => {
    expect(source).toContain('value="AVAILABLE_OVERRIDE"');
    expect(source).toContain('name="environment_id"');
    expect(source).toContain('environment_id: String(data.get("kind")) === "AVAILABLE_OVERRIDE"');
  });
});
