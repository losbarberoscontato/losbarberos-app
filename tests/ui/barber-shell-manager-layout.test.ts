import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/components/connected-barber/barber-shell.tsx"), "utf8");

describe("barber shell manager layout", () => {
  it("uses the root manager shell while retaining only barber modules", () => {
    expect(source).toContain('className="manager-sidebar"');
    expect(source).toContain('className="manager-topbar"');
    expect(source).toContain('className="manager-bottom-nav"');
    expect(source).toContain('{ href: "/barbeiro/agenda", label: "Agenda"');
    expect(source).toContain('context.cash_access_enabled');
    expect(source).toContain('href: "/barbeiro/perfil", label: "Meu perfil"');
    expect(source).not.toContain('href: "/gestor/financeiro"');
    expect(source).toContain('className="organization-switcher" href="/barbeiro"');
    expect(source).not.toContain('className="topbar-preview">Trocar barbearia');
  });
});
