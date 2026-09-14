import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModulesManager } from "@/components/connected-manager/modules-manager";

const refresh = vi.fn();
const rpc = vi.fn(() => Promise.resolve({ data: {}, error: null }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/connected-manager/mutation-utils", () => ({
  connectedClient: () => ({ rpc }),
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
  beforeEach(() => { cleanup(); refresh.mockReset(); rpc.mockClear(); });

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
});
