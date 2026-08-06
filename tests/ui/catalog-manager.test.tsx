import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CatalogManager } from "@/components/connected-manager/catalog-manager";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const mutationMocks = vi.hoisted(() => ({
  update: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })) })),
  rpc: vi.fn(() => Promise.resolve({ error: null })),
}));
vi.mock("@/components/connected-manager/mutation-utils", () => ({
  connectedClient: () => ({ from: () => ({ update: mutationMocks.update }), rpc: mutationMocks.rpc }),
  assertResult: (result: unknown) => result,
  runMutation: async (_setMessage: unknown, mutation: () => Promise<unknown>) => { await mutation(); return true; },
}));

const service = {
  id: "service-1",
  organization_id: "org-1",
  name: "Corte",
  description: null,
  price_cents: 5000,
  duration_minutes: 30,
  active: true,
  sort_order: 0,
  audiences: ["INFANTIL"] as const,
};

const packageRecord = {
  id: "package-1",
  organization_id: "org-1",
  name: "Combo",
  description: null,
  price_cents: 9000,
  active: true,
  sort_order: 0,
  audiences: ["MASCULINO", "FEMININO"] as const,
};

describe("catálogo do gestor", () => {
  afterEach(() => cleanup());

  it("mostra públicos múltiplos e conta somente itens ativos do pacote", () => {
    render(
      <CatalogManager
        organizationId="org-1"
        billingStatus="TRIALING"
        services={[service]}
        packages={[packageRecord]}
        packageItems={[
          { id: "item-1", organization_id: "org-1", package_id: "package-1", service_id: "service-1", quantity: 1, position: 0, active: true },
          { id: "item-old", organization_id: "org-1", package_id: "package-1", service_id: "service-1", quantity: 1, position: 0, active: false },
        ]}
      />,
    );

    expect(screen.getByText("1 itens")).toBeInTheDocument();
    expect(screen.getByText("Infantil")).toBeInTheDocument();
    expect(screen.getByText("Masculino · Feminino")).toBeInTheDocument();
  });

  it("confirma inativação do pacote em modal e não altera ao cancelar", async () => {
    const { fireEvent } = await import("@testing-library/react");
    render(<CatalogManager organizationId="org-1" billingStatus="TRIALING" services={[service]} packages={[packageRecord]} packageItems={[]} />);
    const packagePanel = screen.getByRole("heading", { name: "Pacotes" }).closest("section");
    if (!packagePanel) throw new Error("Pacotes panel missing");
    fireEvent.click(within(packagePanel).getByRole("button", { name: "Inativar" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Deseja inativar este pacote?");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mutationMocks.update).not.toHaveBeenCalled();

    fireEvent.click(within(packagePanel).getByRole("button", { name: "Inativar" }));
    fireEvent.click(screen.getByRole("button", { name: "Inativar pacote" }));
    expect(mutationMocks.rpc).toHaveBeenCalledWith("set_package_active", { p_organization_id: "org-1", p_package_id: "package-1", p_active: false });
  });
});
