import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FinancialReportsManager } from "@/components/connected-manager/financial-reports-manager";

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
    { organization_id: "org-1", appointment_id: "appointment-1", appointment_item_id: "item-1", customer_id: "customer-1", customer_name: "Cliente Um", barber_id: "barber-1", service_id: "service-1", service_name: "Barba", location_id: "location-1", service_date: "2026-09-06", service_value_paid_cents: 7000, financial_account_names: "Nubank", commission_cents: 3500, paid_commission_cents: 0, payable_commission_cents: 3500 },
    { organization_id: "org-1", appointment_id: "appointment-2", appointment_item_id: "item-2", customer_id: "customer-2", customer_name: "Cliente Dois", barber_id: "barber-1", service_id: "service-2", service_name: "Acabamento", location_id: "location-1", service_date: "2026-09-04", service_value_paid_cents: 2000, financial_account_names: "Nubank", commission_cents: 1000, paid_commission_cents: 0, payable_commission_cents: 1000 },
    { organization_id: "org-1", appointment_id: "appointment-3", appointment_item_id: "item-3", customer_id: "customer-3", customer_name: "Cliente Três", barber_id: "barber-1", service_id: "service-3", service_name: "Corte", location_id: "location-1", service_date: "2026-09-03", service_value_paid_cents: 7000, financial_account_names: "Caixa Físico", commission_cents: 3500, paid_commission_cents: 3500, payable_commission_cents: 0 },
  ],
} as unknown as Parameters<typeof FinancialReportsManager>[0];

describe("manager commissions", () => {
  beforeEach(() => { cleanup(); refresh.mockReset(); rpc.mockClear(); });

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
    fireEvent.change(screen.getByRole("combobox", { name: "Banco ou caixa" }), { target: { value: "account-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));

    await waitFor(() => expect(rpc).toHaveBeenCalledWith("pay_commission", expect.objectContaining({
      p_appointment_item_ids: ["item-1", "item-2"],
    })));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
