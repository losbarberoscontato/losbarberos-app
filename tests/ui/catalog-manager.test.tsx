import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  id: "service-1", organization_id: "org-1", name: "Corte", description: null,
  price_cents: 5000, duration_minutes: 30, active: true, sort_order: 0,
  audiences: ["INFANTIL"] as const, accepts_subscription: true, accepts_online_payment: false,
};
const packageRecord = {
  id: "package-1", organization_id: "org-1", name: "Combo", description: null,
  price_cents: 9000, active: true, sort_order: 0,
  audiences: ["MASCULINO", "FEMININO"] as const, accepts_subscription: false, accepts_online_payment: false,
};

function switchToPackages() { fireEvent.click(screen.getByRole("button", { name: "Pacotes" })); }
function panel(title: string) {
  const result = screen.getByRole("heading", { name: title, level: 2 }).closest("section");
  if (!result) throw new Error(`${title} panel missing`);
  return result;
}

describe("catálogo do gestor", () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("separa serviços e pacotes em abas", () => {
    render(<CatalogManager organizationId="org-1" billingStatus="TRIALING" services={[service]} packages={[packageRecord]} packageItems={[]} />);
    expect(screen.getByRole("heading", { name: "Serviços", level: 2 })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Pacotes", level: 2 })).not.toBeInTheDocument();
    switchToPackages();
    expect(screen.getByRole("heading", { name: "Pacotes", level: 2 })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Serviços", level: 2 })).not.toBeInTheDocument();
  });

  it("abre cadastro de serviço em modal", () => {
    render(<CatalogManager organizationId="org-1" billingStatus="TRIALING" services={[service]} packages={[]} packageItems={[]} />);
    fireEvent.click(within(panel("Serviços")).getByRole("button", { name: "Adicionar serviço" }));
    const dialog = screen.getByRole("dialog", { name: "Adicionar serviço" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByRole("checkbox", { name: /Aceita assinatura/ })).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: /Aceita pagamento online/ })).toBeInTheDocument();
  });

  it("calcula preço e duração do pacote, permite ajuste e chama RPC v3", () => {
    render(<CatalogManager organizationId="org-1" billingStatus="TRIALING" services={[service]} packages={[]} packageItems={[]} />);
    switchToPackages();
    fireEvent.click(within(panel("Pacotes")).getByRole("button", { name: "Adicionar pacote" }));
    const dialog = screen.getByRole("dialog", { name: "Adicionar pacote" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Nome" }), { target: { value: "Combo Corte" } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Infantil" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Corte" }));
    expect(within(dialog).getByRole("textbox", { name: /Preço do pacote/u })).toHaveValue("50,00");
    expect(within(dialog).getByRole("spinbutton", { name: "Duração (minutos)" })).toHaveValue(30);
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Preço do pacote/u }), { target: { value: "40,00" } });
    expect(within(dialog).getByText(/Diferença para soma dos serviços: R\$\s?10,00 \(20,00%\) menor/u)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: "Duração (minutos)" }), { target: { value: "45" } });
    const subscription = within(dialog).getByRole("checkbox", { name: /Aceita assinatura/ });
    const onlinePayment = within(dialog).getByRole("checkbox", { name: /Aceita pagamento online/ });
    expect(subscription).toBeEnabled();
    expect(onlinePayment).toBeDisabled();
    fireEvent.click(subscription);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cadastrar pacote" }));
    expect(mutationMocks.rpc).toHaveBeenCalledWith("save_package_with_items_v3", expect.objectContaining({
      p_organization_id: "org-1", p_items: [{ service_id: "service-1", quantity: 1 }],
      p_price_cents: 4000, p_duration_minutes: 45,
      p_accepts_subscription: true, p_accepts_online_payment: false,
    }));
  });

  it("mostra públicos múltiplos e conta somente itens ativos do pacote", () => {
    render(<CatalogManager organizationId="org-1" billingStatus="TRIALING" services={[service]} packages={[packageRecord]} packageItems={[
      { id: "item-1", organization_id: "org-1", package_id: "package-1", service_id: "service-1", quantity: 1, position: 0, active: true },
      { id: "item-old", organization_id: "org-1", package_id: "package-1", service_id: "service-1", quantity: 1, position: 0, active: false },
    ]} />);
    switchToPackages();
    expect(screen.getByText("1 itens")).toBeInTheDocument();
    expect(screen.getByText("Masculino · Feminino")).toBeInTheDocument();
    expect(within(panel("Pacotes")).getByRole("combobox", { name: "Filtro de pacotes" })).toHaveValue("ACTIVE");
  });

  it("confirma inativação do pacote em modal e não altera ao cancelar", () => {
    render(<CatalogManager organizationId="org-1" billingStatus="TRIALING" services={[service]} packages={[packageRecord]} packageItems={[]} />);
    switchToPackages();
    const packagePanel = panel("Pacotes");
    fireEvent.click(within(packagePanel).getByRole("button", { name: "Inativar" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Deseja inativar este pacote?");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mutationMocks.rpc).not.toHaveBeenCalled();
    fireEvent.click(within(packagePanel).getByRole("button", { name: "Inativar" }));
    fireEvent.click(screen.getByRole("button", { name: "Inativar pacote" }));
    expect(mutationMocks.rpc).toHaveBeenCalledWith("set_package_active", { p_organization_id: "org-1", p_package_id: "package-1", p_active: false });
  });

  it("filtra serviços e edita suas flags", () => {
    const inactiveService = { ...service, id: "service-2", name: "Barba inativa", active: false };
    render(<CatalogManager organizationId="org-1" billingStatus="TRIALING" services={[service, inactiveService]} packages={[]} packageItems={[]} />);
    const servicePanel = panel("Serviços");
    const filter = within(servicePanel).getByRole("combobox", { name: "Filtro de serviços" });
    expect(within(servicePanel).queryByText("Barba inativa")).not.toBeInTheDocument();
    fireEvent.change(filter, { target: { value: "INACTIVE" } });
    expect(within(servicePanel).getByText("Barba inativa")).toBeInTheDocument();
    fireEvent.change(filter, { target: { value: "ACTIVE" } });
    fireEvent.click(within(servicePanel).getByRole("button", { name: "Editar" }));
    const dialog = screen.getByRole("dialog", { name: "Editar serviço" });
    expect(within(dialog).getByRole("checkbox", { name: /Aceita assinatura/ })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: /Aceita pagamento online/ })).not.toBeChecked();
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar serviço" }));
    expect(mutationMocks.update).toHaveBeenCalledWith(expect.objectContaining({
      organization_id: "org-1", name: "Corte", accepts_subscription: true, accepts_online_payment: false,
    }));
  });
});
