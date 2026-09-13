import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const cash = readFileSync(resolve(process.cwd(), "src/components/connected-barber/cash.tsx"), "utf8");
const server = readFileSync(resolve(process.cwd(), "src/lib/barber-server.ts"), "utf8");
const auth = readFileSync(resolve(process.cwd(), "src/lib/barber-auth.ts"), "utf8");

describe("barber cash layout and scope", () => {
  it("keeps only overview and cash tabs and omits manager-only reconciliation", () => {
    expect(cash).toContain("Visão geral");
    expect(cash).toContain("Saldo das contas");
    expect(cash).toContain("Total recebido");
    expect(cash).not.toContain("Conferência de Caixa");
    expect(cash).not.toContain("Comissões");
    expect(cash).not.toContain("Contas a pagar");
    expect(cash).not.toContain("Contas a receber");
    expect(cash).not.toContain("Relatórios");
  });

  it("limits completed appointments and account totals to the authenticated barber cash", () => {
    expect(server).toContain('.eq("barber_id", context.barber_id)');
    expect(server).toContain('.eq("received_by_barber_id", context.barber_id)');
    expect(server).toContain("accountBalances");
    expect(server).toContain('receipt.status !== "REVERSED"');
  });

  it("allows only the dedicated overview route in addition to the cash route", () => {
    expect(auth).toContain('"/barbeiro/financeiro"');
    expect(auth).not.toContain('"/barbeiro/financeiro/comissoes"');
  });
});
