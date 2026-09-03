import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/components/connected-manager/team-manager.tsx"), "utf8");

describe("team manager barber access", () => {
  it("confirms the saved agenda scope and shows mutation feedback inside the modal", () => {
    expect(source).toContain('.select("id,agenda_access_scope").maybeSingle()');
    expect(source).toContain('Não foi possível confirmar a atualização do profissional.');
    expect(source).toContain('<ActionMessage message={message}');
  });
});
