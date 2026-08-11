import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CashManager } from "@/components/connected-manager/cash-manager";
import styles from "@/components/connected-manager/connected-manager.module.css";

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
  accounts: [{ id: "account-1", organization_id: "org-1", kind: "BANK" as const, name: "Banco Principal", bank_code: null, branch: null, account_number: null, description: null, opening_balance_cents: 5000, active: true }],
  balances: [{ financial_account_id: "account-1", balance_cents: 8000 }],
  suppliers: [{ id: "supplier-1", organization_id: "org-1", person_kind: "COMPANY" as const, name: "Imobiliária Real", document: null, phone_e164: null, email: null, address: {}, notes: null, active: true }],
  chartAccounts: [{ id: "chart-revenue", organization_id: "org-1", parent_id: null, code: "1", name: "Serviços", kind: "REVENUE" as const, active: true }, { id: "chart-expense", organization_id: "org-1", parent_id: null, code: "2", name: "Estrutura", kind: "EXPENSE" as const, active: true }],
  costCenters: [],
  tags: [],
  customers: [{ id: "customer-1", organization_id: "org-1", full_name: "Cliente Real", active: true }],
  entries: [{ id: "entry-1", organization_id: "org-1", kind: "EXPENSE" as const, description: "Aluguel", issue_date: "2026-08-01", due_date: "2026-08-10", total_cents: 100000, settled_cents: 0, remaining_cents: 100000, status: "OPEN" as const, chart_account_id: "chart-expense", cost_center_id: null, preferred_financial_account_id: "account-1", counterparty_kind: "SUPPLIER" as const, customer_id: null, supplier_id: "supplier-1", document_number: "ALU-01", canceled_at: null, cancellation_reason: null }],
  entryTags: [],
  settlements: [],
  appointmentActivity: [{ payment_transaction_id: "payment-1", organization_id: "org-1", appointment_id: "appointment-1", customer_id: "customer-1", payment_mode: "COUNTER", provider: "MANUAL" as const, kind: "CAPTURE" as const, amount_cents: 8000, signed_cents: 8000, occurred_at: "2026-08-09T10:00:00.000Z", financial_account_id: "account-1", needs_reconciliation: false, display_description: "Corte clássico · Profissional: Alef", financial_status: "PAID" }],
  mappings: [],
};

describe("cash manager", () => {
  beforeEach(() => { cleanup(); refresh.mockReset(); rpc.mockClear(); });

  it("filters manual entries and keeps appointment receipts visibly linked", () => {
    render(<CashManager {...props} />);
    expect(screen.getByRole("heading", { name: "Controle de caixa" })).toBeInTheDocument();
    expect(screen.getByText("Aluguel")).toBeInTheDocument();
    expect(screen.getByText("Corte clássico · Profissional: Alef")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Buscar descrição, documento ou contraparte"), { target: { value: "aluguel" } });
    expect(screen.getByText("Aluguel")).toBeInTheDocument();
    expect(screen.queryByText("Corte clássico · Profissional: Alef")).not.toBeInTheDocument();
  });

  it("shows a paid appointment separately from its unmapped financial account and filters movements by inclusive date", () => {
    render(<CashManager {...props} appointmentActivity={[{
      ...props.appointmentActivity[0],
      needs_reconciliation: true,
      display_description: "Corte clássico · Profissional: Alef",
      financial_status: "PAID",
    }]} />);

    expect(screen.getByRole("columnheader", { name: "Cliente/Fornecedor" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Situação do pagamento" })).toBeInTheDocument();
    expect(screen.getByText("Cliente Real")).toBeInTheDocument();
    expect(screen.getByText("Imobiliária Real")).toBeInTheDocument();
    expect(screen.getByText("Corte clássico · Profissional: Alef")).toHaveClass(styles.cashDescription);
    expect(screen.getByText("Aluguel")).toHaveClass(styles.cashDescription);
    expect(screen.getByText("Corte clássico · Profissional: Alef")).toBeInTheDocument();
    expect(screen.getByText("Recebido")).toBeInTheDocument();
    expect(screen.getByText("Não vinculada")).toBeInTheDocument();
    expect(screen.queryByText("Aguardando conciliação")).not.toBeInTheDocument();
    expect(screen.queryByText("PENDENTE")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Data inicial"), { target: { value: "2026-08-09" } });
    fireEvent.change(screen.getByLabelText("Data final"), { target: { value: "2026-08-09" } });

    expect(screen.getByText("Corte clássico · Profissional: Alef")).toBeInTheDocument();
    expect(screen.queryByText("Aluguel")).not.toBeInTheDocument();
  });

  it("opens a cash entry form without calling Supabase in advance", () => {
    render(<CashManager {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Novo lançamento" }));
    expect(screen.getByRole("dialog", { name: "Novo lançamento" })).toBeInTheDocument();
    expect(screen.getByLabelText("Descrição")).toBeInTheDocument();
  });

  it("opens the appointment receipt with prefilled fields and records only the payment transaction", () => {
    render(<CashManager {...props} section="receivables" appointmentReceivables={[{
      appointment_id: "appointment-2",
      organization_id: "org-1",
      customer_id: "customer-1",
      customer_name: "Cliente Real",
      description: "Barba completa · Profissional: Alef",
      amount_cents: 6500,
      issue_date: "2026-08-09",
      due_date: "2026-08-11",
      document_number: "ATD-APPOINT2",
      outstanding_cents: 6500,
    }]} />);

    fireEvent.click(screen.getByRole("button", { name: "Receber" }));
    expect(screen.getByRole("dialog", { name: "Receber atendimento" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Cliente Real")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Barba completa · Profissional: Alef")).toBeInTheDocument();
    expect(screen.getByDisplayValue("ATD-APPOINT2")).toBeInTheDocument();
    fireEvent.submit(screen.getByRole("button", { name: "Confirmar recebimento" }).closest("form")!);

    expect(rpc).toHaveBeenCalledWith("record_manual_appointment_receipt", expect.objectContaining({ p_appointment_id: "appointment-2", p_amount_cents: 6500, p_receipt: expect.objectContaining({ document_number: "ATD-APPOINT2" }) }));
    expect(rpc).not.toHaveBeenCalledWith("create_financial_entry", expect.anything());
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

  it("gives chart accounts and cost centers full-width stacked panels", () => {
    render(<CashManager {...props} section="catalogs" />);

    const chartPanel = screen.getByRole("heading", { name: "Plano de contas" }).closest("section");
    const costCenterPanel = screen.getByRole("heading", { name: "Centro de custo" }).closest("section");

    expect(chartPanel).toHaveClass(styles.span12);
    expect(costCenterPanel).toHaveClass(styles.span12);
    expect(chartPanel?.compareDocumentPosition(costCenterPanel!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
