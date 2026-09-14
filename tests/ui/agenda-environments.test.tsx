import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/connected-manager/agenda-manager.tsx", "utf8");

describe("manager agenda environment layout", () => {
  it("uses ordered environments as daily columns", () => {
    expect(source).toContain("displayedEnvironments");
    expect(source).toContain("environment_id === environment.id");
    expect(source).toContain("ambientes");
  });

  it("keeps barber filters and professional names inside event cards", () => {
    expect(source).toContain("Filtrar por profissional");
    expect(source).toContain("barberName");
    expect(source).toContain("p_environment_id");
  });
});
