import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FinancialReportsManager } from "@/components/connected-manager/financial-reports-manager";
import { calculateOpenCommissionCents } from "@/components/connected-manager/finance-manager";

const refresh = vi.fn();
const rpc = vi.fn(() => Promise.resolve({ data: "settlement-1", error: null }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/connected-manager/mutation-utils", () => ({
  connectedClient: () => ({ rpc }),
  assertResult: (result: unknown) => result,
  runMutation: async (_setMessage: unknown, mutation: () => Promise<unknown>) => { await mutation(); return true; },
}));

const props = {
  organizationId: "org-1",
  billingStatus: "ACTIVE",
  from: "2026-09-01",
  to: "2026-09-30",
  facts: [],
  customers: [],
  barbers: [{ id: "barber-1", organization_id: "org-1", location_id: "location-1", display_name: "Barbeiro Real", bio: null, avatar_url: null, whatsapp_e164: null, active: true }],
  locations: [{ id: "location-1", organization_id: "org-1", name: "Unidade principal", address: {}, active: true }],
  chartAccounts: [],
  costCenters: [],
  accounts: [{ id: "account-1", organization_id: "org-1", kind: "BANK" as const, name: "Conta principal", bank_code: null, branch: null, account_number: null, description: null, opening_balance_cents: 0, active: true }],
  budgetVersions: [],
  commissionDetails: [
    { organization_id: "org-1", appointment_id: "appointment-1", appointment_item_id: "item-1", customer_id: "customer-1", customer_name: "Cliente Um", barber_id: "barber-1", service_id: "service-1", service_name: "Barba", location_id: "location-1", service_date: "2026-09-06", received_on: "2026-09-06", service_value_paid_cents: 7000, financial_account_names: "Nubank", commission_cents: 3500, paid_commission_cents: 0, payable_commission_cents: 3500 },
    { organization_id: "org-1", appointment_id: "appointment-2", appointment_item_id: "item-2", customer_id: "customer-2", customer_name: "Cliente Dois", barber_id: "barber-1", service_id: "service-2", service_name: "Acabamento", location_id: "location-1", service_date: "2026-09-04", received_on: "2026-09-04", service_value_paid_cents: 2000, financial_account_names: "Nubank", commission_cents: 1000, paid_commission_cents: 0, payable_commission_cents: 1000 },
    { organization_id: "org-1", appointment_id: "appointment-3", appointment_item_id: "item-3", customer_id: "customer-3", customer_name: "Cliente Três", barber_id: "barber-1", service_id: "service-3", service_name: "Corte", location_id: "location-1", service_date: "2026-09-03", received_on: "2026-09-03", service_value_paid_cents: 7000, financial_account_names: "Caixa Físico", commission_cents: 3500, paid_commission_cents: 3500, payable_commission_cents: 0 },
  ],
} as unknown as Parameters<typeof FinancialReportsManager>[0];

describe("manager commissions", () => {
  beforeEach(() => { cleanup(); refresh.mockReset(); rpc.mockClear(); });

  it("does not subtract canceled commission payouts from the open total", () => {
    expect(calculateOpenCommissionCents(
      [{ amount_cents: 44825 }],
      [{ amount_cents: 3500, status: "CANCELED" }],
    )).toBe(44825);
  });

  it("shows only DFC and budget reports with the requested filters", () => {
    render(<FinancialReportsManager {...props} />);

    expect(screen.getByRole("button", { name: "Fluxo de caixa (DFC)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Orçamento" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dashboard" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "DRE" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Data inicial")).toBeInTheDocument();
    expect(screen.getByLabelText("Data final")).toBeInTheDocument();
    expect(screen.getByLabelText("Plano de conta")).toBeInTheDocument();
    expect(screen.getByLabelText("Centro de custo")).toBeInTheDocument();
    expect(screen.getByLabelText("Unidade")).toBeInTheDocument();
    expect(screen.getByLabelText("Pesquisar por tag")).toBeInTheDocument();
    expect(screen.queryByLabelText("Cliente")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Profissional")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Serviço")).not.toBeInTheDocument();
  });

  it("filters DFC facts by tag text", () => {
    render(<FinancialReportsManager {...props} facts={[
      { organization_id: "org-1", basis: "CASH", source_type: "FINANCIAL_SETTLEMENT", source_id: "settlement-1", fact_date: "2026-09-06", competence_date: null, due_date: null, settlement_date: "2026-09-06", location_id: "location-1", customer_id: null, barber_id: null, service_id: null, service_name_snapshot: "Receita marcada", chart_account_id: null, cost_center_id: null, financial_account_id: "account-1", dre_group: "GROSS_REVENUE", cash_flow_activity: "OPERATING", signed_cents: 7000, status: "SETTLEMENT", tag_names: ["Prioridade"] },
      { organization_id: "org-1", basis: "CASH", source_type: "FINANCIAL_SETTLEMENT", source_id: "settlement-2", fact_date: "2026-09-05", competence_date: null, due_date: null, settlement_date: "2026-09-05", location_id: "location-1", customer_id: null, barber_id: null, service_id: null, service_name_snapshot: "Receita comum", chart_account_id: null, cost_center_id: null, financial_account_id: "account-1", dre_group: "GROSS_REVENUE", cash_flow_activity: "OPERATING", signed_cents: 3000, status: "SETTLEMENT", tag_names: ["Rotina"] },
    ]} />);

    fireEvent.change(screen.getByLabelText("Pesquisar por tag"), { target: { value: "prior" } });
    expect(screen.getAllByText("R$ 70,00")).not.toHaveLength(0);
    expect(screen.queryByText("R$ 100,00")).not.toBeInTheDocument();
  });

  it("selects open commissions, locks paid rows, and sends only the selection to payment", async () => {
    render(<FinancialReportsManager {...props} initialReport="COMMISSIONS" />);

    fireEvent.click(screen.getByRole("row", { name: /Barbeiro Real/ }));
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(3);
    expect(checkboxes[2]).toBeDisabled();

    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);
    expect(screen.getByText("Total selecionado: R$ 45,00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Pagar Comissão" }));
    expect(screen.getByDisplayValue("R$ 45,00")).toHaveAttribute("readonly");
    const documentNumber = screen.getByLabelText("Número do documento");
    const generatedDocumentNumber = (documentNumber as HTMLInputElement).value;
    expect(generatedDocumentNumber).toMatch(/^COM-[A-Z0-9]{10}$/);
    expect(documentNumber).toHaveAttribute("readonly");
    fireEvent.change(screen.getByLabelText("Tags"), { target: { value: "Comissão setembro" } });
    expect(screen.getByLabelText("Data do lançamento")).toHaveValue("2026-09-06");
    expect(screen.getByLabelText("Vencimento")).not.toHaveAttribute("readonly");
    fireEvent.change(screen.getByLabelText("Vencimento"), { target: { value: "2026-09-09" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Banco ou caixa" }), { target: { value: "account-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));

    await waitFor(() => expect(rpc).toHaveBeenCalledWith("pay_commission", expect.objectContaining({
      p_appointment_item_ids: ["item-1", "item-2"],
      p_launch_on: "2026-09-06",
      p_due_on: "2026-09-09",
      p_document_number: generatedDocumentNumber,
      p_tags: "Comissão setembro",
    })));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
