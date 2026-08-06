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
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

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
    const packagePanel = screen.getByRole("heading", { name: "Pacotes" }).closest("section");
    if (!packagePanel) throw new Error("Pacotes panel missing");
    expect(within(packagePanel).getByRole("combobox", { name: "Filtro de pacotes" })).toHaveValue("ACTIVE");
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

  it("confirma reativacao do pacote com aviso para clientes", async () => {
    const { fireEvent } = await import("@testing-library/react");
    render(<CatalogManager organizationId="org-1" billingStatus="BLOCKED" services={[service]} packages={[{ ...packageRecord, active: false }]} packageItems={[]} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Filtro de pacotes" }), { target: { value: "INACTIVE" } });
    const packagePanel = screen.getByRole("heading", { name: "Pacotes" }).closest("section");
    if (!packagePanel) throw new Error("Pacotes panel missing");
    fireEvent.click(within(packagePanel).getByRole("button", { name: "Reativar" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Esta ação fará este pacote aparecer novamente para seus clientes.");
    fireEvent.click(screen.getByRole("button", { name: "Reativar pacote" }));
    expect(mutationMocks.rpc).toHaveBeenCalledWith("set_package_active", { p_organization_id: "org-1", p_package_id: "package-1", p_active: true });
  });
  it("filtra serviços ativos por padrão e permite ver inativos", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const inactiveService = { ...service, id: "service-2", name: "Barba inativa", active: false };
    render(<CatalogManager organizationId="org-1" billingStatus="TRIALING" services={[service, inactiveService]} packages={[]} packageItems={[]} />);
    const servicePanel = screen.getByRole("heading", { name: "Serviços" }).closest("section");
    if (!servicePanel) throw new Error("Servicos panel missing");
    const filter = within(servicePanel).getByRole("combobox", { name: "Filtro de serviços" });
    expect(filter).toHaveValue("ACTIVE");
    expect(within(servicePanel).getByText("Corte")).toBeInTheDocument();
    expect(within(servicePanel).queryByText("Barba inativa")).not.toBeInTheDocument();
    fireEvent.change(filter, { target: { value: "INACTIVE" } });
    expect(within(servicePanel).getByText("Barba inativa")).toBeInTheDocument();
    expect(within(servicePanel).queryByText("Corte")).not.toBeInTheDocument();
  });

  it("abre edição do serviço com os dados atuais preenchidos", async () => {
    const { fireEvent } = await import("@testing-library/react");
    render(<CatalogManager organizationId="org-1" billingStatus="TRIALING" services={[service]} packages={[]} packageItems={[]} />);
    const servicePanel = screen.getByRole("heading", { name: "Serviços" }).closest("section");
    if (!servicePanel) throw new Error("Servicos panel missing");
    fireEvent.click(within(servicePanel).getByRole("button", { name: "Editar" }));
    expect(within(servicePanel).getByDisplayValue("Corte")).toBeInTheDocument();
    expect(within(servicePanel).getByDisplayValue("50,00")).toBeInTheDocument();
    expect(within(servicePanel).getByRole("checkbox", { name: "Infantil" })).toBeChecked();
    fireEvent.click(within(servicePanel).getByRole("button", { name: "Salvar" }));
    expect(mutationMocks.update).toHaveBeenCalledWith({
      organization_id: "org-1",
      name: "Corte",
      description: null,
      price_cents: 5000,
      duration_minutes: 30,
      audiences: ["INFANTIL"],
    });
  });

  it("confirma inativação e reativação do serviço pela RPC", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const { rerender } = render(<CatalogManager organizationId="org-1" billingStatus="BLOCKED" services={[service]} packages={[]} packageItems={[]} />);
    let servicePanel = screen.getByRole("heading", { name: "Serviços" }).closest("section");
    if (!servicePanel) throw new Error("Servicos panel missing");
    fireEvent.click(within(servicePanel).getByRole("button", { name: "Inativar" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Deseja inativar este serviço?");
    fireEvent.click(screen.getByRole("button", { name: "Inativar serviço" }));
    expect(mutationMocks.rpc).toHaveBeenCalledWith("set_service_active", { p_organization_id: "org-1", p_service_id: "service-1", p_active: false });

    rerender(<CatalogManager organizationId="org-1" billingStatus="BLOCKED" services={[{ ...service, active: false }]} packages={[]} packageItems={[]} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Filtro de serviços" }), { target: { value: "INACTIVE" } });
    servicePanel = screen.getByRole("heading", { name: "Serviços" }).closest("section");
    if (!servicePanel) throw new Error("Servicos panel missing");
    fireEvent.click(within(servicePanel).getByRole("button", { name: "Reativar" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Esta ação fará este serviço aparecer novamente para seus clientes.");
    fireEvent.click(screen.getByRole("button", { name: "Reativar serviço" }));
    expect(mutationMocks.rpc).toHaveBeenCalledWith("set_service_active", { p_organization_id: "org-1", p_service_id: "service-1", p_active: true });
  });
});
