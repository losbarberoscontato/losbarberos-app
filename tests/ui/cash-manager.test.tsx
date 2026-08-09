import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CashManager } from "@/components/connected-manager/cash-manager";

const refresh = vi.fn();
const rpc = vi.fn(() => Promise.resolve({ error: null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/connected-manager/mutation-utils", () => ({
  connectedClient: () => ({ rpc }),
  assertResult: (result: unknown) => result,
  runMutation: async (_setMessage: unknown, mutation: () => Promise<unknown>) => { await mutation(); return true; },
}));

const props = {
  section: "cash" as const,
  organizationId: "org-1",
  billingStatus: "ACTIVE" as const,
  accounts: [{ id: "account-1", organization_id: "org-1", kind: "BANK" as const, name: "Banco Principal", bank_code: null, branch: null, account_number: null, opening_balance_cents: 5000, active: true }],
  balances: [{ financial_account_id: "account-1", balance_cents: 8000 }],
  suppliers: [{ id: "supplier-1", organization_id: "org-1", person_kind: "COMPANY" as const, name: "Imobiliária Real", document: null, phone_e164: null, email: null, address: {}, notes: null, active: true }],
  chartAccounts: [{ id: "chart-revenue", organization_id: "org-1", parent_id: null, code: "1", name: "Serviços", kind: "REVENUE" as const, active: true }, { id: "chart-expense", organization_id: "org-1", parent_id: null, code: "2", name: "Estrutura", kind: "EXPENSE" as const, active: true }],
  costCenters: [],
  tags: [],
  customers: [{ id: "customer-1", organization_id: "org-1", full_name: "Cliente Real", active: true }],
  entries: [{ id: "entry-1", organization_id: "org-1", kind: "EXPENSE" as const, description: "Aluguel", issue_date: "2026-08-01", due_date: "2026-08-10", total_cents: 100000, settled_cents: 0, remaining_cents: 100000, status: "OPEN" as const, chart_account_id: "chart-expense", cost_center_id: null, preferred_financial_account_id: "account-1", counterparty_kind: "SUPPLIER" as const, customer_id: null, supplier_id: "supplier-1", document_number: "ALU-01", canceled_at: null, cancellation_reason: null }],
  entryTags: [],
  settlements: [],
  appointmentActivity: [{ payment_transaction_id: "payment-1", organization_id: "org-1", appointment_id: "appointment-1", customer_id: "customer-1", payment_mode: "COUNTER", provider: "MANUAL" as const, kind: "CAPTURE" as const, amount_cents: 8000, signed_cents: 8000, occurred_at: "2026-08-09T10:00:00.000Z", financial_account_id: "account-1", needs_reconciliation: false }],
  mappings: [],
};

describe("cash manager", () => {
  beforeEach(() => { cleanup(); refresh.mockReset(); rpc.mockClear(); });

  it("filters manual entries and keeps appointment receipts visibly linked", () => {
    render(<CashManager {...props} />);
    expect(screen.getByRole("heading", { name: "Controle de caixa" })).toBeInTheDocument();
    expect(screen.getByText("Aluguel")).toBeInTheDocument();
    expect(screen.getByText("Recebimento de agendamento")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Buscar descrição, documento ou contraparte"), { target: { value: "aluguel" } });
    expect(screen.getByText("Aluguel")).toBeInTheDocument();
    expect(screen.queryByText("Recebimento de agendamento")).not.toBeInTheDocument();
  });

  it("opens a cash entry form without calling Supabase in advance", () => {
    render(<CashManager {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Novo lançamento" }));
    expect(screen.getByRole("dialog", { name: "Novo lançamento" })).toBeInTheDocument();
    expect(screen.getByLabelText("Descrição")).toBeInTheDocument();
  });

  it("does not call Supabase when a demo entry is submitted", () => {
    render(<CashManager {...props} demoMode />);
    fireEvent.click(screen.getByRole("button", { name: "Novo lançamento" }));
    fireEvent.change(screen.getByLabelText("Descrição"), { target: { value: "Receita de teste" } });
    fireEvent.change(screen.getByLabelText("Valor (R$)"), { target: { value: "10,00" } });
    fireEvent.change(screen.getByLabelText("Plano de conta"), { target: { value: "chart-revenue" } });
    fireEvent.submit(screen.getByRole("button", { name: "Adicionar" }).closest("form")!);

    expect(rpc).not.toHaveBeenCalled();
    expect(screen.getByText("Modo demonstração: nenhuma alteração é salva.")).toBeInTheDocument();
  });

  it("does not write when a demo account is inactivated", () => {
    render(<CashManager {...props} section="accounts" demoMode />);
    fireEvent.click(screen.getByRole("button", { name: "Inativar" }));

    expect(rpc).not.toHaveBeenCalled();
    expect(screen.getByText("Modo demonstração: nenhuma alteração é salva.")).toBeInTheDocument();
  });

  it("groups chart accounts by nature in collapsed code-ordered columns", () => {
    render(<CashManager {...props} section="catalogs" chartAccounts={[
      { id: "revenue-root", organization_id: "org-1", parent_id: null, code: "1", name: "Serviços", kind: "REVENUE", active: true },
      { id: "revenue-barba", organization_id: "org-1", parent_id: "revenue-root", code: "1.10", name: "Barba", kind: "REVENUE", active: true },
      { id: "revenue-corte", organization_id: "org-1", parent_id: "revenue-root", code: "1.2", name: "Corte", kind: "REVENUE", active: true },
      { id: "expense-root", organization_id: "org-1", parent_id: null, code: "2", name: "Estrutura", kind: "EXPENSE", active: true },
    ]} />);

    expect(screen.getByRole("button", { name: "Mostrar planos de receitas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mostrar planos de despesas" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Planos de receitas" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mostrar planos de receitas" }));
    const revenuePlans = screen.getByRole("list", { name: "Planos de receitas" });
    expect(within(revenuePlans).getAllByRole("listitem").map((item) => item.textContent)).toEqual([expect.stringContaining("1 · Serviços"), expect.stringContaining("1.2 · Corte"), expect.stringContaining("1.10 · Barba")]);
    expect(within(screen.getByLabelText("Conta superior")).getByRole("option", { name: "1 · Serviços" })).toBeInTheDocument();
    expect(within(screen.getByLabelText("Conta superior")).queryByRole("option", { name: "2 · Estrutura" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mostrar planos de despesas" }));
    expect(screen.getByRole("list", { name: "Planos de despesas" })).toHaveTextContent("2 · Estrutura");
    expect(screen.getByRole("list", { name: "Planos de receitas" })).toBeInTheDocument();
  });
});
