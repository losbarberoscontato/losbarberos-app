import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
    try {
      render(<CashManager {...props} />);
      expect(screen.getByRole("heading", { name: "Controle de caixa" })).toBeInTheDocument();
      expect(screen.getByText("Movimentações do dia")).toBeInTheDocument();
      expect(screen.queryByText("Entradas realizadas")).not.toBeInTheDocument();
      expect(screen.getByRole("columnheader", { name: "Ações" }).className).toContain("cashHeaderAction");
      expect(screen.queryByText("Somente valores efetivamente recebidos ou pagos.")).not.toBeInTheDocument();
      expect(screen.queryByText("Aluguel")).not.toBeInTheDocument();
      expect(screen.getByText("Corte clássico · Profissional: Alef")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Liquidar" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Estornar recebimento" })).toBeInTheDocument();

      fireEvent.change(screen.getByPlaceholderText("Buscar descrição, documento ou contraparte"), { target: { value: "aluguel" } });
      expect(screen.queryByText("Aluguel")).not.toBeInTheDocument();
      expect(screen.queryByText("Corte clássico · Profissional: Alef")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("calcula o saldo líquido somente das movimentações do dia", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
    try {
      const settledExpense = { ...props.entries[0], kind: "EXPENSE" as const, status: "SETTLED" as const, total_cents: 3000, settled_cents: 3000, remaining_cents: 0 };
      render(<CashManager
        {...props}
        entries={[settledExpense]}
        settlements={[{ id: "settlement-today", entry_id: settledExpense.id, financial_account_id: "account-1", kind: "SETTLEMENT" as const, amount_cents: 3000, settled_on: "2026-08-15", payment_method: "PIX", reference: null }]}
        appointmentActivity={[
          { ...props.appointmentActivity[0], occurred_at: "2026-08-15T10:00:00.000Z", signed_cents: 8000 },
          { ...props.appointmentActivity[0], payment_transaction_id: "payment-old", occurred_at: "2026-08-14T10:00:00.000Z", signed_cents: 9900 },
        ]}
      />);

      expect(screen.getByText("Movimentações do dia")).toBeInTheDocument();
      expect(screen.getByText(/R\$\s*50,00/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a paid appointment separately from its unmapped financial account and filters movements by inclusive date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
    try {
      render(<CashManager {...props} appointmentActivity={[{
        ...props.appointmentActivity[0],
        needs_reconciliation: true,
        display_description: "Corte clássico · Profissional: Alef",
        financial_status: "PAID",
      }]} />);

      expect(screen.getByRole("columnheader", { name: "Cliente/Fornecedor" })).toBeInTheDocument();
      expect(screen.queryByRole("columnheader", { name: "Situação do pagamento" })).not.toBeInTheDocument();
      expect(screen.getByText("Cliente Real")).toBeInTheDocument();
      expect(screen.queryByText("Imobiliária Real")).not.toBeInTheDocument();
      expect(screen.getByText("Corte clássico · Profissional: Alef")).toHaveClass(styles.cashDescription);
      expect(screen.getByText("Não vinculada")).toBeInTheDocument();
      expect(screen.queryByText("Recebido")).not.toBeInTheDocument();
      expect(screen.queryByText("Aguardando conciliação")).not.toBeInTheDocument();
      expect(screen.queryByText("PENDENTE")).not.toBeInTheDocument();
      expect(screen.getByText("09/08/2026")).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText("Data inicial"), { target: { value: "2026-08-09" } });
      fireEvent.change(screen.getByLabelText("Data final"), { target: { value: "2026-08-09" } });

      expect(screen.getByText("Corte clássico · Profissional: Alef")).toBeInTheDocument();
      expect(screen.queryByText("Aluguel")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("abre a Caixa no mês atual e oferece filtro de conta financeira", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
    try {
      render(<CashManager {...props} accounts={[...props.accounts, { ...props.accounts[0], id: "account-2", name: "Caixa físico" }]} />);

      expect(screen.getByLabelText("Data inicial")).toHaveValue("2026-08-01");
      expect(screen.getByLabelText("Data final")).toHaveValue("2026-08-31");
      expect(screen.getByLabelText("Filtrar conta financeira")).toHaveValue("ALL");
      expect(screen.getByRole("option", { name: "Caixa físico" })).toBeInTheDocument();
      expect(screen.queryByLabelText("Filtrar status")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("mostra settlements liquidados com contraparte, data brasileira e conta filtrável", () => {
    const settledEntry = {
      ...props.entries[0],
      id: "entry-settled",
      kind: "REVENUE" as const,
      description: "Corte adicional",
      total_cents: 6500,
      settled_cents: 6500,
      remaining_cents: 0,
      status: "SETTLED" as const,
      chart_account_id: "chart-revenue",
      counterparty_kind: null,
      supplier_id: "supplier-1",
    };
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
    try {
      render(<CashManager {...props} accounts={[...props.accounts, { ...props.accounts[0], id: "account-2", name: "Caixa físico" }]} entries={[...props.entries, settledEntry]} settlements={[{ id: "settlement-1", entry_id: "entry-settled", financial_account_id: "account-1", kind: "SETTLEMENT" as const, amount_cents: 6500, settled_on: "2026-08-10", payment_method: "PIX", reference: null }]} />);

      expect(screen.getByText("Imobiliária Real")).toBeInTheDocument();
      expect(screen.getByText("10/08/2026")).toBeInTheDocument();
      expect(screen.getByText("Corte adicional")).toBeInTheDocument();
      expect(screen.getByText(/R\$\s*65,00/)).toBeInTheDocument();
      expect(screen.getAllByText("Banco Principal").length).toBeGreaterThan(0);
      expect(screen.queryByRole("columnheader", { name: "Situação do pagamento" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Liquidar" })).not.toBeInTheDocument();

      fireEvent.change(screen.getByLabelText("Filtrar conta financeira"), { target: { value: "account-2" } });
      expect(screen.queryByText("Corte adicional")).not.toBeInTheDocument();
      expect(screen.queryByText("Corte clássico · Profissional: Alef")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("oculta lançamentos liquidados das contas a pagar", () => {
    const settled = { ...props.entries[0], id: "settled-payable", description: "Despesa já paga", kind: "EXPENSE" as const, status: "SETTLED" as const, settled_cents: 1000, remaining_cents: 0 };
    render(<CashManager {...props} section="payables" entries={[settled]} />);
    expect(screen.queryByText("Despesa já paga")).not.toBeInTheDocument();
  });

  it("opens a cash entry form without calling Supabase in advance", () => {
    render(<CashManager {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Novo lançamento" }));
    expect(screen.getByRole("dialog", { name: "Novo lançamento" })).toBeInTheDocument();
    expect(screen.getByLabelText("Descrição")).toBeInTheDocument();
  });

  it("cria despesa única na sub tela correta e fecha o modal", async () => {
    render(<CashManager {...props} section="payables" />);

    expect(screen.queryByLabelText("Filtrar tipo")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Novo lançamento" }));
    const dialog = screen.getByRole("dialog", { name: "Novo lançamento" });
    expect(within(dialog).getByLabelText("Tipo de despesa")).toHaveValue("SINGLE");
    fireEvent.change(within(dialog).getByLabelText("Descrição"), { target: { value: "Energia" } });
    fireEvent.change(within(dialog).getByLabelText("Valor (R$)"), { target: { value: "120,00" } });
    fireEvent.change(within(dialog).getByLabelText("Plano de conta"), { target: { value: "chart-expense" } });
    fireEvent.submit(within(dialog).getByRole("button", { name: "Adicionar" }).closest("form")!);

    expect(rpc).toHaveBeenCalledWith("create_financial_entry", expect.objectContaining({ p_organization_id: "org-1", p_kind: "EXPENSE", p_description: "Energia", p_total_cents: 12000 }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Novo lançamento" })).not.toBeInTheDocument());
    expect(refresh).toHaveBeenCalled();
  });

  it("abre contas a pagar e receber no mês atual, com todos os status", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
    try {
      render(<CashManager {...props} section="payables" />);

      expect(screen.getByLabelText("Data inicial")).toHaveValue("2026-08-01");
      expect(screen.getByLabelText("Data final")).toHaveValue("2026-08-31");
      expect(screen.getByLabelText("Filtrar status")).toHaveValue("ALL");
    } finally {
      vi.useRealTimers();
    }
  });

  it("abre cadastros rápidos de fornecedor, cliente e tag no lançamento", () => {
    render(<CashManager {...props} section="payables" />);
    fireEvent.click(screen.getByRole("button", { name: "Novo lançamento" }));
    const dialog = screen.getByRole("dialog", { name: "Novo lançamento" });

    fireEvent.change(within(dialog).getByLabelText("Tipo de contraparte"), { target: { value: "SUPPLIER" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Novo fornecedor" }));
    expect(screen.getByRole("dialog", { name: "Novo fornecedor" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Fechar" }).at(-1)!);

    fireEvent.change(within(dialog).getByLabelText("Tipo de contraparte"), { target: { value: "CUSTOMER" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Novo cliente" }));
    expect(screen.getByRole("dialog", { name: "Novo cliente" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Fechar" }).at(-1)!);

    fireEvent.click(within(dialog).getByRole("button", { name: "Nova tag" }));
    expect(screen.getByRole("dialog", { name: "Nova tag" })).toBeInTheDocument();
  });

  it("calcula total das parcelas e cria série tenant-safe", async () => {
    render(<CashManager {...props} section="payables" />);

    fireEvent.click(screen.getByRole("button", { name: "Novo lançamento" }));
    const dialog = screen.getByRole("dialog", { name: "Novo lançamento" });
    fireEvent.change(within(dialog).getByLabelText("Tipo de despesa"), { target: { value: "INSTALLMENT" } });
    fireEvent.change(within(dialog).getByLabelText("Descrição"), { target: { value: "Cadeira" } });
    fireEvent.change(within(dialog).getByLabelText("Valor da parcela (R$)"), { target: { value: "250,00" } });
    fireEvent.change(within(dialog).getByLabelText("Qtd. de parcelas"), { target: { value: "4" } });
    expect(within(dialog).getByLabelText("Total (R$)")).toHaveValue("R$ 1.000,00");
    fireEvent.change(within(dialog).getByLabelText("Plano de conta"), { target: { value: "chart-expense" } });
    fireEvent.submit(within(dialog).getByRole("button", { name: "Adicionar" }).closest("form")!);

    expect(rpc).toHaveBeenCalledWith("create_financial_series", expect.objectContaining({ p_organization_id: "org-1", p_kind: "INSTALLMENT", p_cadence: "MONTHLY", p_occurrence_count: 4, p_total_cents: 100000 }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Novo lançamento" })).not.toBeInTheDocument());
  });

  it("cria recorrência quinzenal e filtra despesas por período e status", async () => {
    render(<CashManager {...props} section="payables" entries={[...props.entries, { ...props.entries[0], id: "entry-canceled", description: "Água", due_date: "2026-08-15", status: "CANCELED", canceled_at: "2026-08-01T00:00:00Z", cancellation_reason: "Teste" }]} />);

    fireEvent.change(screen.getByLabelText("Data inicial"), { target: { value: "2026-08-15" } });
    fireEvent.change(screen.getByLabelText("Data final"), { target: { value: "2026-08-15" } });
    fireEvent.change(screen.getByLabelText("Filtrar status"), { target: { value: "CANCELED" } });
    expect(screen.queryByText("Água")).not.toBeInTheDocument();
    expect(screen.queryByText("Aluguel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Novo lançamento" }));
    const dialog = screen.getByRole("dialog", { name: "Novo lançamento" });
    fireEvent.change(within(dialog).getByLabelText("Tipo de despesa"), { target: { value: "RECURRING" } });
    fireEvent.change(within(dialog).getByLabelText("Tipo de recorrência"), { target: { value: "BIWEEKLY" } });
    fireEvent.change(within(dialog).getByLabelText("Descrição"), { target: { value: "Internet" } });
    fireEvent.change(within(dialog).getByLabelText("Valor por vencimento (R$)"), { target: { value: "99,90" } });
    fireEvent.change(within(dialog).getByLabelText("Plano de conta"), { target: { value: "chart-expense" } });
    fireEvent.submit(within(dialog).getByRole("button", { name: "Adicionar" }).closest("form")!);

    expect(rpc).toHaveBeenCalledWith("create_financial_series", expect.objectContaining({ p_kind: "RECURRING", p_cadence: "BIWEEKLY", p_amount_cents: 9990, p_occurrence_count: null, p_counterparty_kind: null, p_tag_ids: [] }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Novo lançamento" })).not.toBeInTheDocument());
  });

  it("uses a modal to add banks and keeps appointment receipt mappings hidden", () => {
    render(<CashManager {...props} section="accounts" />);

    expect(screen.getByRole("heading", { name: "Bancos", level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Recebimentos de agendamento" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Adicionar conta" }));
    expect(screen.getByRole("dialog", { name: "Adicionar conta" })).toBeInTheDocument();
    expect(screen.getByLabelText("Código do banco")).toBeInTheDocument();
  });

  it("opens the appointment receipt with prefilled fields and records only the payment transaction", () => {
    render(<CashManager {...props} section="receivables" tags={[{ id: "tag-1", organization_id: "org-1", name: "Cliente recorrente", color: null, active: true }]} appointmentReceivables={[{
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
    expect(screen.getByLabelText("Observações")).toBeInTheDocument();
    expect(screen.queryByLabelText("Referência")).not.toBeInTheDocument();
    expect(screen.queryByText("Pode ser maior ou menor que o valor agendado.")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Tags"), { target: { value: "tag-1" } });
    fireEvent.submit(screen.getByRole("button", { name: "Confirmar recebimento" }).closest("form")!);

    expect(rpc).toHaveBeenCalledWith("record_manual_appointment_receipt_v2", expect.objectContaining({ p_appointment_id: "appointment-2", p_amount_cents: 6500, p_chart_account_id: "chart-revenue", p_financial_account_id: "account-1", p_document_number: "ATD-APPOINT2", p_tag_ids: ["tag-1"] }));
    expect(rpc).not.toHaveBeenCalledWith("create_financial_entry", expect.anything());
  });

  it("sends the adjusted final amount without requiring an adjustment reason", () => {
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
    fireEvent.change(screen.getByLabelText(/Valor final lançado \(R\$\)/), { target: { value: "71,00" } });
    fireEvent.submit(screen.getByRole("button", { name: "Confirmar recebimento" }).closest("form")!);
    expect(rpc).toHaveBeenLastCalledWith("record_manual_appointment_receipt_v2", expect.objectContaining({ p_amount_cents: 7100, p_adjustment_reason: "Ajuste automático do valor final no recebimento" }));
    expect(screen.queryByLabelText("Motivo do ajuste")).not.toBeInTheDocument();
  });

  it("does not call Supabase when a demo entry is submitted", () => {
    render(<CashManager {...props} demoMode />);
    fireEvent.click(screen.getByRole("button", { name: "Novo lançamento" }));
    fireEvent.change(screen.getByLabelText("Descrição"), { target: { value: "Receita de teste" } });
    fireEvent.change(screen.getByLabelText("Valor (R$)"), { target: { value: "10,00" } });
    fireEvent.change(screen.getByLabelText("Plano de conta"), { target: { value: "chart-revenue" } });
    fireEvent.submit(screen.getByRole("button", { name: "Lançar no Caixa" }).closest("form")!);

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
