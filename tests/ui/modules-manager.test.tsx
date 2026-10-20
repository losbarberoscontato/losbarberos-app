import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModulesManager } from "@/components/connected-manager/modules-manager";

const refresh = vi.fn();
const rpc = vi.fn(() => Promise.resolve({ data: {}, error: null }));
const invoke = vi.fn(() => Promise.resolve({ data: { enabled: true }, error: null }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/connected-manager/mutation-utils", () => ({
  connectedClient: () => ({ rpc, functions: { invoke } }),
  assertResult: (result: unknown) => result,
  runMutation: async (_setMessage: unknown, mutation: () => Promise<unknown>) => { await mutation(); return true; },
}));

const props = {
  organizationId: "org-1",
  billingStatus: "ACTIVE" as const,
  modules: [{ key: "projects", name: "Projetos", description: "Relatório de projetos.", active: true }],
  entitlements: [{ module_key: "projects", enabled: false, changed_at: "2026-09-14T00:00:00.000Z", data_retention_until: null, data_retention_status: "NONE" as const }],
  prices: [],
};

describe("modules manager", () => {
  beforeEach(() => { cleanup(); refresh.mockReset(); rpc.mockClear(); invoke.mockClear(); });

  it("requires the addendum and enables Projetos through the generic module contract", async () => {
    render(<ModulesManager {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Ativar" }));
    expect(screen.getByRole("dialog", { name: "Ativar Projetos" })).toBeInTheDocument();
    const activate = screen.getByRole("button", { name: "Aceitar e ativar" });
    expect(activate).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(activate);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("accept_module_contract_and_enable", expect.objectContaining({
      p_module_key: "projects",
      p_contract_version: "v1",
    })));
  });

  it("explains the 60-day retention window when disabling Projetos", async () => {
    render(<ModulesManager {...props} entitlements={[{ ...props.entitlements[0], enabled: true }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Desativar" }));
    expect(screen.getByText(/retenção de 60 dias/i)).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("set_organization_module_enabled", expect.objectContaining({
      p_module_key: "projects",
      p_enabled: false,
    }));
  });

  it("ativa Kanban somente após preço, data e aceite, via sincronização Stripe", async () => {
    const kanbanModule = { key: "kanban", name: "Kanban", description: "Atendimentos.", active: true };
    const entitlement = { ...props.entitlements[0], module_key: "kanban" };
    const { rerender } = render(<ModulesManager {...props} modules={[kanbanModule]} entitlements={[entitlement]} />);
    expect(screen.getByRole("button", { name: "Ativar" })).toBeDisabled();
    rerender(<ModulesManager {...props} modules={[kanbanModule]} entitlements={[entitlement]} productKey="los-barberos" nextChargeAt="2026-11-20T15:00:00Z" kanbanBilling={null} kanbanPrices={[{
      id: "price-version-1", product_key: "los-barberos", monthly_price_cents: 1900,
      contract_version: "v1", contract_body: "Aditivo mensal do Kanban para este produto.", retired_at: null,
    }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Ativar" }));
    expect(screen.getByText("Aditivo mensal do Kanban para este produto.")).toBeInTheDocument();
    expect(screen.getByText(/Início da cobrança: 20\/11\/2026/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Aceitar e ativar" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("stripe-kanban-module", expect.objectContaining({
      body: expect.objectContaining({ action: "ENABLE", contractVersion: "v1" }),
    })));
    expect(rpc).not.toHaveBeenCalledWith("accept_module_contract_and_enable", expect.anything());
  });
});
