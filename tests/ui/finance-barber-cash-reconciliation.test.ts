import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const finance = readFileSync(resolve(process.cwd(), "src/components/connected-manager/finance-manager.tsx"), "utf8");
const reconciliation = readFileSync(resolve(process.cwd(), "src/components/connected-manager/barber-cash-reconciliation.tsx"), "utf8");
const server = readFileSync(resolve(process.cwd(), "src/components/connected-manager/server.ts"), "utf8");

describe("finance barber cash reconciliation", () => {
  it("loads daily barber cash sessions into the reconciliation card", () => {
    expect(server).toContain('supabase.from("barber_cash_sessions")');
    expect(server).toContain("barberCashSessions:");
    expect(server).toContain("barberNames:");
    expect(finance).toContain("Caixas diários dos Barbeiros");
    expect(finance).toContain("<BarberCashSessionReconciliation");
  });

  it("reuses the manager-only reconciliation RPC for open daily cash sessions", () => {
    expect(reconciliation).toContain('"reconcile_barber_cash_session"');
    expect(reconciliation).toContain("Conciliar e fechar");
    expect(reconciliation).toContain("Motivo da diferença");
  });
});
