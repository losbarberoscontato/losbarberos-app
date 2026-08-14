import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const component = () => readFileSync(resolve(process.cwd(), "src/components/walkin-queue.tsx"), "utf8");

describe("layout da fila presencial", () => {
  it("separa vagas futuras em Matutino, Vespertino e Noturno", () => {
    const source = component();
    expect(source).toContain('label: "Matutino"');
    expect(source).toContain('label: "Vespertino"');
    expect(source).toContain('label: "Noturno"');
    expect(source).toContain("groupWalkinSlots");
  });

  it("permite filtrar a agenda por barbeiro e destaca a primeira vaga de cada um", () => {
    const source = component();
    expect(source).toContain("selectedBarberId");
    expect(source).toContain("walkin-queue__barber-filter");
    expect(source).toContain("nextSlots");
    expect(source).toContain("Próximas vagas por barbeiro");
  });
});
