import { notFound, redirect } from "next/navigation";
import { CashManager, type CashManagerProps } from "@/components/connected-manager/cash-manager";
import type { FinanceSection } from "@/components/connected-manager/types";
import { loadCashData } from "@/components/connected-manager/server";
import { hasSupabaseConfig } from "@/lib/env";

const sections: Record<string, FinanceSection> = {
  caixa: "cash",
  "contas-pagar": "payables",
  "contas-receber": "receivables",
  bancos: "accounts",
  fornecedores: "suppliers",
  cadastros: "catalogs",
};

function demoData(section: FinanceSection): CashManagerProps {
  return {
    section,
    organizationId: "demo",
    billingStatus: "ACTIVE",
    demoMode: true,
    accounts: [{ id: "demo-bank", organization_id: "demo", kind: "BANK", name: "Banco principal", bank_code: null, branch: null, account_number: null, description: null, opening_balance_cents: 548000, active: true }, { id: "demo-cash", organization_id: "demo", kind: "CASH", name: "Caixa Físico", bank_code: "0", branch: "1", account_number: "0", description: "Caixa físico para recebimento à vista em dinheiro físico.", opening_balance_cents: 0, active: true }],
    balances: [{ financial_account_id: "demo-bank", balance_cents: 548000 }, { financial_account_id: "demo-cash", balance_cents: 32400 }],
    suppliers: [{ id: "demo-supplier", organization_id: "demo", person_kind: "COMPANY", name: "Produtos do Barbeiro", document: "12.345.678/0001-00", phone_e164: null, email: "contato@fornecedor.demo", address: {}, notes: null, active: true }],
    chartAccounts: [{ id: "demo-revenue", organization_id: "demo", parent_id: null, code: "1.01", name: "Serviços", kind: "REVENUE", active: true }, { id: "demo-expense", organization_id: "demo", parent_id: null, code: "2.01", name: "Produtos", kind: "EXPENSE", active: true }],
    costCenters: [{ id: "demo-center", organization_id: "demo", name: "Unidade principal", active: true }],
    tags: [{ id: "demo-tag", organization_id: "demo", name: "recorrente", color: "#2f6b5d", active: true }],
    customers: [{ id: "demo-customer", organization_id: "demo", full_name: "Guilherme Costa", active: true }],
    entries: [{ id: "demo-entry", organization_id: "demo", kind: "EXPENSE", description: "Reposição de produtos", issue_date: "2026-08-09", due_date: "2026-08-15", total_cents: 89000, settled_cents: 0, remaining_cents: 89000, status: "OPEN", chart_account_id: "demo-expense", cost_center_id: "demo-center", preferred_financial_account_id: "demo-bank", counterparty_kind: "SUPPLIER", customer_id: null, supplier_id: "demo-supplier", document_number: "NF-1048", canceled_at: null, cancellation_reason: null }],
    entryTags: [{ entry_id: "demo-entry", tag_id: "demo-tag" }],
    settlements: [],
    appointmentActivity: [{ payment_transaction_id: "demo-payment", organization_id: "demo", appointment_id: "demo-appointment", customer_id: "demo-customer", payment_mode: "COUNTER", provider: "MANUAL", kind: "CAPTURE", amount_cents: 8000, signed_cents: 8000, occurred_at: "2026-08-09T15:00:00.000Z", financial_account_id: "demo-cash", needs_reconciliation: false, display_description: "Corte · Profissional: Guilherme", financial_status: "PAID" }],
    mappings: [{ id: "demo-mapping", organization_id: "demo", provider: "MANUAL", payment_mode: "COUNTER", financial_account_id: "demo-cash" }],
  };
}

export default async function FinanceSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section: rawSection } = await params;
  const section = sections[rawSection];
  if (!section) notFound();
  if (!hasSupabaseConfig) return <CashManager {...demoData(section)} />;
  const data = await loadCashData();
  if (data.billingStatus === "CANCELED_RETENTION" || data.billingStatus === "CLOSED") redirect("/regularizacao");
  return <CashManager section={section} {...data} />;
}
