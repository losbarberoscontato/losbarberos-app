"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { ArrowLeftRight, Building2, ChevronRight, CircleDollarSign, Landmark, Plus, ReceiptText, Tags, X } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { centsFromInput, formatCents } from "./format";
import { assertResult, connectedClient, runMutation } from "./mutation-utils";
import type { AppointmentReceiptDraft } from "./appointment-receipt";
import { ActionMessage, EmptyState, Field, Panel, StatusChip } from "./shared";
import type {
  AppointmentCashActivityRecord,
  AppointmentReceivableRecord,
  ChartAccountRecord,
  CostCenterRecord,
  CustomerRecord,
  FinancialAccountBalanceRecord,
  FinancialAccountRecord,
  FinancialEntryRecord,
  FinancialEntryTagRecord,
  FinancialSettlementRecord,
  FinancialTagRecord,
  FinanceSection,
  PaymentAccountMappingRecord,
  SupplierRecord,
} from "./types";
import styles from "./connected-manager.module.css";

const financeSections: Array<{ id: FinanceSection; label: string; href: string }> = [
  { id: "overview", label: "Visão geral", href: "/gestor/financeiro" },
  { id: "cash", label: "Caixa", href: "/gestor/financeiro/caixa" },
  { id: "payables", label: "Contas a pagar", href: "/gestor/financeiro/contas-pagar" },
  { id: "receivables", label: "Contas a receber", href: "/gestor/financeiro/contas-receber" },
  { id: "accounts", label: "Bancos", href: "/gestor/financeiro/bancos" },
  { id: "suppliers", label: "Fornecedores", href: "/gestor/financeiro/fornecedores" },
  { id: "catalogs", label: "Cadastros", href: "/gestor/financeiro/cadastros" },
  { id: "reports", label: "Relatórios", href: "/gestor/financeiro/relatorios" },
];

export type CashManagerProps = {
  section: FinanceSection;
  organizationId: string;
  billingStatus: string | null;
  accounts: FinancialAccountRecord[];
  balances: FinancialAccountBalanceRecord[];
  suppliers: SupplierRecord[];
  chartAccounts: ChartAccountRecord[];
  costCenters: CostCenterRecord[];
  tags: FinancialTagRecord[];
  customers: Pick<CustomerRecord, "id" | "organization_id" | "full_name" | "active">[];
  entries: FinancialEntryRecord[];
  entryTags: FinancialEntryTagRecord[];
  settlements: FinancialSettlementRecord[];
  appointmentActivity: AppointmentCashActivityRecord[];
  mappings: PaymentAccountMappingRecord[];
  appointmentReceivables?: AppointmentReceivableRecord[];
  demoMode?: boolean;
};

type EntryKind = FinancialEntryRecord["kind"];
type EntryStatus = FinancialEntryRecord["status"];

// Payment gateway accounts will be created and classified by their integration.
// Keep the mapping implementation for that release, but do not expose it while
// appointment deposits and full prepayments are not enabled.
const SHOW_APPOINTMENT_RECEIPT_MAPPINGS = false;

const statusLabel: Record<EntryStatus, string> = {
  OPEN: "Em aberto",
  PARTIAL: "Parcial",
  SETTLED: "Liquidado",
  OVERDUE: "Vencido",
  CANCELED: "Cancelado",
};

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function currentMonthRange() {
  const [year, month] = today().split("-").map(Number);
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: first, end: `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}` };
}

function movementDate(value: string) {
  return value.includes("T") ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(value)) : value;
}

function isDateInRange(value: string, start: string, end: string) {
  const date = movementDate(value);
  return (!start || date >= start) && (!end || date <= end);
}

function appointmentPaymentLabel(status: string) {
  return ({ PAID: "Recebido", PARTIAL: "Parcial", UNPAID: "Em aberto", REFUND_PENDING: "Estorno pendente", PARTIALLY_REFUNDED: "Parcialmente estornado", REFUNDED: "Estornado" } as Record<string, string>)[status] ?? status.replaceAll("_", " ");
}

function safeText(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function boolActive(status: EntryStatus) {
  return status === "SETTLED" || status === "PARTIAL" || status === "OPEN";
}

function blockDemoWrite(demoMode: boolean | undefined, setMessage: (value: string) => void) {
  if (!demoMode) return false;
  setMessage("Modo demonstração: nenhuma alteração é salva.");
  return true;
}

export function FinanceSubnav({ active }: { active: FinanceSection }) {
  return <nav className={styles.tabs} aria-label="Seções do Financeiro">
    {financeSections.map((item) => <Link key={item.id} href={item.href} className={`${styles.tab} ${active === item.id ? styles.tabActive : ""}`} aria-current={active === item.id ? "page" : undefined}>{item.label}</Link>)}
  </nav>;
}

export function CashManager(props: CashManagerProps) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | EntryStatus>("ALL");
  const periodDefault = props.section === "payables" || props.section === "receivables" ? currentMonthRange() : null;
  const [startDate, setStartDate] = useState(() => periodDefault?.start ?? "");
  const [endDate, setEndDate] = useState(() => periodDefault?.end ?? "");
  const [entryEditor, setEntryEditor] = useState<FinancialEntryRecord | "new" | null>(null);
  const [settlementEntry, setSettlementEntry] = useState<FinancialEntryRecord | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [reversePayment, setReversePayment] = useState<AppointmentCashActivityRecord | null>(null);
  const [appointmentReceipt, setAppointmentReceipt] = useState<AppointmentReceivableRecord | AppointmentReceiptDraft | null>(null);
  const sectionKind: "ALL" | EntryKind = props.section === "payables" ? "EXPENSE" : props.section === "receivables" ? "REVENUE" : "ALL";

  const accountById = useMemo(() => new Map(props.accounts.map((item) => [item.id, item])), [props.accounts]);
  const supplierById = useMemo(() => new Map(props.suppliers.map((item) => [item.id, item])), [props.suppliers]);
  const customerById = useMemo(() => new Map(props.customers.map((item) => [item.id, item])), [props.customers]);
  const chartById = useMemo(() => new Map(props.chartAccounts.map((item) => [item.id, item])), [props.chartAccounts]);
  const tagNamesByEntry = useMemo(() => {
    const tagById = new Map(props.tags.map((item) => [item.id, item.name]));
    const result = new Map<string, string[]>();
    props.entryTags.forEach((item) => result.set(item.entry_id, [...(result.get(item.entry_id) ?? []), tagById.get(item.tag_id) ?? ""]));
    return result;
  }, [props.entryTags, props.tags]);
  const balanceById = useMemo(() => new Map(props.balances.map((item) => [item.financial_account_id, item.balance_cents])), [props.balances]);

  const visibleEntries = useMemo(() => props.entries.filter((entry) => {
    const counterparty = entry.counterparty_kind === "CUSTOMER" ? customerById.get(entry.customer_id ?? "")?.full_name : supplierById.get(entry.supplier_id ?? "")?.name;
    const haystack = [entry.description, entry.document_number, counterparty, chartById.get(entry.chart_account_id)?.name, ...(tagNamesByEntry.get(entry.id) ?? [])].join(" ").toLocaleLowerCase("pt-BR");
    return (sectionKind === "ALL" || entry.kind === sectionKind) && (statusFilter === "ALL" || entry.status === statusFilter) && isDateInRange(entry.due_date, startDate, endDate) && (!query || haystack.includes(query.toLocaleLowerCase("pt-BR")));
  }), [props.entries, customerById, supplierById, chartById, tagNamesByEntry, sectionKind, statusFilter, startDate, endDate, query]);

  const visibleActivity = useMemo(() => props.appointmentActivity.filter((item) => {
    const customer = customerById.get(item.customer_id)?.full_name ?? "Cliente";
    const haystack = `${customer} ${item.display_description} ${item.provider} ${item.payment_mode}`.toLocaleLowerCase("pt-BR");
    return sectionKind !== "EXPENSE" && isDateInRange(item.occurred_at, startDate, endDate) && (!query || haystack.includes(query.toLocaleLowerCase("pt-BR")));
  }), [props.appointmentActivity, customerById, sectionKind, startDate, endDate, query]);

  const capturedFromAppointments = props.appointmentActivity.reduce((total, item) => total + item.signed_cents, 0);
  const manualRevenue = props.entries.filter((item) => item.kind === "REVENUE").reduce((total, item) => total + item.settled_cents, 0);
  const manualExpense = props.entries.filter((item) => item.kind === "EXPENSE").reduce((total, item) => total + item.settled_cents, 0);
  const balance = props.balances.reduce((total, item) => total + item.balance_cents, 0);
  const openReceivable = props.entries.filter((item) => item.kind === "REVENUE" && !["SETTLED", "CANCELED"].includes(item.status)).reduce((total, item) => total + item.remaining_cents, 0) + (props.appointmentReceivables ?? []).reduce((total, item) => total + item.outstanding_cents, 0);
  const openPayable = props.entries.filter((item) => item.kind === "EXPENSE" && !["SETTLED", "CANCELED"].includes(item.status)).reduce((total, item) => total + item.remaining_cents, 0);

  async function reverseAppointmentReceipt() {
    if (!reversePayment) return;
    if (blockDemoWrite(props.demoMode, setMessage)) { setReversePayment(null); return; }
    const reference = window.prompt("Referência do estorno (comprovante ou protocolo):");
    if (!reference?.trim()) return;
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("reverse_appointment_cash_receipt", {
        p_payment_transaction_id: reversePayment.payment_transaction_id,
        p_reference: reference.trim(),
        p_idempotency_key: `manager:cash-appointment-reversal:${crypto.randomUUID()}`,
      }));
    }, "Estorno registrado. Serviço continua concluído e saldo foi reaberto.");
    if (saved) { setReversePayment(null); router.refresh(); }
  }

  const title = props.section === "overview" ? "Financeiro" : props.section === "cash" ? "Controle de caixa" : financeSections.find((item) => item.id === props.section)?.label ?? "Financeiro";
  const description = props.demoMode ? "Modo demonstração: dados locais, sem escrita no Supabase." : "Lançamentos auditáveis; valores liquidado não são apagados.";

  return <div className={styles.stack}>
    <PageHeader title={title} description={description} actions={props.section === "cash" ? <button className={styles.button} type="button" onClick={() => setEntryEditor("new")}><Plus size={16} /> Novo lançamento</button> : undefined} />
    <FinanceSubnav active={props.section} />
    <ActionMessage message={message} />

    {props.section === "overview" && <>
      <CashStats balance={balance} incoming={manualRevenue + capturedFromAppointments} outgoing={manualExpense} openReceivable={openReceivable} openPayable={openPayable} />
      <Panel title="Próximo passo" description="Controle despesas, recebimentos e contas bancárias sem duplicar pagamentos de agendamento.">
        <Link className={styles.button} href="/gestor/financeiro/caixa">Abrir Caixa <ChevronRight size={16} /></Link>
      </Panel>
    </>}
    {(props.section === "cash" || props.section === "payables" || props.section === "receivables") && <>
      <CashStats balance={balance} incoming={manualRevenue + capturedFromAppointments} outgoing={manualExpense} openReceivable={openReceivable} openPayable={openPayable} />
      <div className={styles.toolbar}>
        <div className={styles.toolbarGroup}>
          <input className={styles.packageFilterSelect} aria-label="Buscar lançamentos" placeholder="Buscar descrição, documento ou contraparte" value={query} onChange={(event) => setQuery(event.target.value)} />
          <input className={styles.packageFilterSelect} aria-label="Data inicial" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          <input className={styles.packageFilterSelect} aria-label="Data final" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          <select className={styles.packageFilterSelect} aria-label="Filtrar status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "ALL" | EntryStatus)}><option value="ALL">Todos status</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        </div>
        {props.section !== "cash" && <button className={styles.button} type="button" onClick={() => setEntryEditor("new")}><Plus size={16} /> Novo lançamento</button>}
      </div>
      <CashList entries={visibleEntries} activity={visibleActivity} receivables={props.section === "receivables" ? (props.appointmentReceivables ?? []) : []} accountById={accountById} supplierById={supplierById} customerById={customerById} onEdit={setEntryEditor} onSettle={setSettlementEntry} onReceive={setAppointmentReceipt} onCancel={async (entry) => {
        if (blockDemoWrite(props.demoMode, setMessage)) return;
        const reason = window.prompt("Motivo obrigatório do cancelamento:");
        if (!reason?.trim()) return;
        const saved = await runMutation(setMessage, async () => { await assertResult(await connectedClient().rpc("cancel_financial_entry", { p_entry_id: entry.id, p_reason: reason.trim() })); }, "Lançamento cancelado sem apagar histórico.");
        if (saved) router.refresh();
      }} onTransfer={() => setTransferOpen(true)} onReverseAppointment={setReversePayment} />
    </>}
    {props.section === "accounts" && <AccountsSection {...props} balanceById={balanceById} accountById={accountById} setMessage={setMessage} />}
    {props.section === "suppliers" && <SuppliersSection organizationId={props.organizationId} suppliers={props.suppliers} demoMode={props.demoMode} setMessage={setMessage} />}
    {props.section === "catalogs" && <CatalogsSection organizationId={props.organizationId} chartAccounts={props.chartAccounts} costCenters={props.costCenters} tags={props.tags} accounts={props.accounts} mappings={props.mappings} demoMode={props.demoMode} setMessage={setMessage} />}

    {entryEditor && <EntryDialog entry={entryEditor === "new" ? null : entryEditor} defaultKind={sectionKind === "ALL" ? "REVENUE" : sectionKind} {...props} onClose={() => setEntryEditor(null)} onSaved={() => { setEntryEditor(null); router.refresh(); }} setMessage={setMessage} />}
    {appointmentReceipt && <AppointmentReceiptDialog receipt={appointmentReceipt} accounts={props.accounts} chartAccounts={props.chartAccounts} costCenters={props.costCenters} tags={props.tags} mappings={props.mappings} demoMode={props.demoMode} onClose={() => setAppointmentReceipt(null)} onSaved={() => { setAppointmentReceipt(null); router.refresh(); }} setMessage={setMessage} />}
    {settlementEntry && <SettlementDialog entry={settlementEntry} accounts={props.accounts} demoMode={props.demoMode} onClose={() => setSettlementEntry(null)} onSaved={() => { setSettlementEntry(null); router.refresh(); }} setMessage={setMessage} />}
    {transferOpen && <TransferDialog accounts={props.accounts} demoMode={props.demoMode} onClose={() => setTransferOpen(false)} onSaved={() => { setTransferOpen(false); router.refresh(); }} setMessage={setMessage} />}
    {reversePayment && <ConfirmDialog title="Estornar recebimento do agendamento?" description="O valor será estornado ao cliente e o saldo do agendamento será reaberto. Serviço e agendamento continuam concluídos." confirmLabel="Confirmar estorno" onClose={() => setReversePayment(null)} onConfirm={() => void reverseAppointmentReceipt()} />}
  </div>;
}

function CashStats({ balance, incoming, outgoing, openReceivable, openPayable }: { balance: number; incoming: number; outgoing: number; openReceivable: number; openPayable: number }) {
  return <section className={styles.stats}>
    <article className={styles.stat}><span>Saldo em contas</span><strong>{formatCents(balance)}</strong><small>saldo inicial + movimentações</small></article>
    <article className={styles.stat}><span>Entradas realizadas</span><strong>{formatCents(incoming)}</strong><small>inclui agendamentos vinculados</small></article>
    <article className={styles.stat}><span>Saídas realizadas</span><strong>{formatCents(outgoing)}</strong><small>despesas liquidadas</small></article>
    <article className={styles.stat}><span>Em aberto</span><strong>{formatCents(openReceivable - openPayable)}</strong><small>{formatCents(openReceivable)} a receber · {formatCents(openPayable)} a pagar</small></article>
  </section>;
}

function CashList({ entries, activity, receivables, accountById, supplierById, customerById, onEdit, onSettle, onReceive, onCancel, onTransfer, onReverseAppointment }: { entries: FinancialEntryRecord[]; activity: AppointmentCashActivityRecord[]; receivables: AppointmentReceivableRecord[]; accountById: Map<string, FinancialAccountRecord>; supplierById: Map<string, SupplierRecord>; customerById: Map<string, Pick<CustomerRecord, "id" | "organization_id" | "full_name" | "active">>; onEdit: (entry: FinancialEntryRecord) => void; onSettle: (entry: FinancialEntryRecord) => void; onReceive: (entry: AppointmentReceivableRecord) => void; onCancel: (entry: FinancialEntryRecord) => void; onTransfer: () => void; onReverseAppointment: (entry: AppointmentCashActivityRecord) => void }) {
  return <Panel title="Movimentações" description="Registros de agendamento são vinculados ao ledger existente e não podem ser editados aqui." action={<button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={onTransfer}><ArrowLeftRight size={15} /> Transferir</button>}>
    {!entries.length && !activity.length && !receivables.length ? <EmptyState title="Sem movimentações">Crie um lançamento ou registre um recebimento de agendamento.</EmptyState> : <div className={styles.cashTable} role="table" aria-label="Movimentações financeiras">
      <div className={styles.cashHeader} role="row"><span role="columnheader">Cliente/Fornecedor</span><span role="columnheader">Data</span><span role="columnheader">Valor</span><span role="columnheader">Conta financeira</span><span role="columnheader">Situação do pagamento</span><span role="columnheader">Ações</span></div>
      {entries.map((entry) => {
        const counterpart = entry.counterparty_kind === "CUSTOMER"
          ? customerById.get(entry.customer_id ?? "")?.full_name
          : supplierById.get(entry.supplier_id ?? "")?.name;
        return <article key={entry.id} className={styles.cashRow} role="row"><span className={styles.rowTitle} role="cell"><strong className={styles.cashCounterparty}>{counterpart ?? "Não informado"}</strong><small className={styles.cashDescription}>{entry.description}</small></span><span role="cell">{entry.due_date}</span><strong role="cell">{entry.kind === "REVENUE" ? "+" : "−"}{formatCents(entry.total_cents)}</strong><span role="cell">{accountById.get(entry.preferred_financial_account_id ?? "")?.name ?? "Não definida"}</span><span role="cell"><StatusChip active={boolActive(entry.status)} label={statusLabel[entry.status]} /></span><span className={styles.rowActions} role="cell">{!["SETTLED", "CANCELED"].includes(entry.status) && <button className={`${styles.button} ${styles.buttonSmall}`} type="button" onClick={() => onSettle(entry)}>Liquidar</button>}{entry.status === "OPEN" || entry.status === "OVERDUE" ? <><button className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} type="button" onClick={() => onEdit(entry)}>Editar</button><button className={`${styles.button} ${styles.buttonDanger} ${styles.buttonSmall}`} type="button" onClick={() => onCancel(entry)}>Excluir</button></> : entry.status !== "CANCELED" ? <small className={styles.muted}>Use reversal para corrigir liquidações.</small> : null}</span></article>;
      })}
      {activity.map((item) => <article key={item.payment_transaction_id} className={styles.cashRow} role="row"><span className={styles.rowTitle} role="cell"><strong className={styles.cashCounterparty}>{customerById.get(item.customer_id)?.full_name ?? "Cliente"}</strong><small className={styles.cashDescription}>{item.display_description}</small></span><span role="cell">{new Date(item.occurred_at).toLocaleDateString("pt-BR")}</span><strong role="cell">{item.signed_cents >= 0 ? "+" : "−"}{formatCents(Math.abs(item.signed_cents))}</strong><span role="cell">{item.needs_reconciliation ? "Não vinculada" : accountById.get(item.financial_account_id ?? "")?.name ?? "Conta não encontrada"}</span><span role="cell"><StatusChip active={item.financial_status === "PAID"} label={appointmentPaymentLabel(item.financial_status)} /></span><span className={styles.rowActions} role="cell">{item.kind === "CAPTURE" && item.provider === "MANUAL" && <button className={`${styles.button} ${styles.buttonDanger} ${styles.buttonSmall}`} type="button" onClick={() => onReverseAppointment(item)}>Estornar recebimento</button>}</span></article>)}
      {receivables.map((item) => <article key={`receivable-${item.appointment_id}`} className={styles.cashRow} role="row"><span className={styles.rowTitle} role="cell"><strong className={styles.cashCounterparty}>{item.customer_name}</strong><small className={styles.cashDescription}>{item.description}</small></span><span role="cell">{item.due_date}</span><strong role="cell">+{formatCents(item.outstanding_cents)}</strong><span role="cell">Caixa Físico</span><span role="cell"><StatusChip active={false} label="A receber" /></span><span className={styles.rowActions} role="cell"><button className={`${styles.button} ${styles.buttonSmall}`} type="button" onClick={() => onReceive(item)}>Receber</button></span></article>)}
    </div>}
  </Panel>;
}

export function AppointmentReceiptDialog({ receipt, accounts = [], chartAccounts = [], costCenters = [], tags = [], mappings = [], demoMode, modalClassName, layerClassName, onClose, onSaved, setMessage }: { receipt: AppointmentReceivableRecord | AppointmentReceiptDraft; accounts?: FinancialAccountRecord[]; chartAccounts?: ChartAccountRecord[]; costCenters?: CostCenterRecord[]; tags?: FinancialTagRecord[]; mappings?: PaymentAccountMappingRecord[]; demoMode?: boolean; modalClassName?: string; layerClassName?: string; onClose: () => void; onSaved: () => void; setMessage: (value: string) => void }) {
  const mappedAccountId = accounts.find((account) => account.active && account.id === mappings.find((item) => item.provider === "MANUAL" && item.payment_mode === "COUNTER")?.financial_account_id)?.id;
  const defaultAccount = mappedAccountId ?? accounts.find((item) => item.active && /caixa/i.test(item.name))?.id ?? accounts.find((item) => item.active)?.id ?? "";
  const defaultChart = chartAccounts.find((item) => item.active && item.kind === "REVENUE" && (item.code === "1" || /receita/i.test(item.name)))?.id ?? "";
  const customerName = "customer_name" in receipt ? receipt.customer_name : receipt.customerName;
  const amountCents = "outstanding_cents" in receipt ? receipt.outstanding_cents : receipt.amountCents;
  const issueDate = "issue_date" in receipt ? receipt.issue_date : receipt.issueDate;
  const dueDate = "due_date" in receipt ? receipt.due_date : receipt.dueDate;
  const documentNumber = "document_number" in receipt ? receipt.document_number : receipt.documentNumber;
  const activeTags = tags.filter((item) => item.active);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blockDemoWrite(demoMode, setMessage)) return;
    const data = new FormData(event.currentTarget);
    const appointmentId = "appointment_id" in receipt ? receipt.appointment_id : receipt.appointmentId;
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("record_manual_appointment_receipt_v2", {
        p_appointment_id: appointmentId,
        p_amount_cents: centsFromInput(data.get("amount")),
        p_payment_method: safeText(data.get("payment_method")),
        p_financial_account_id: safeText(data.get("financial_account_id")),
        p_chart_account_id: safeText(data.get("chart_account_id")),
        p_cost_center_id: safeText(data.get("cost_center_id")) || null,
        p_tag_ids: data.getAll("tag_ids").map(String),
        p_reference: safeText(data.get("reference")) || `${safeText(data.get("document_number"))} · ${safeText(data.get("payment_method"))}`,
        p_document_number: safeText(data.get("document_number")),
        p_idempotency_key: `manager:appointment-receipt:${appointmentId}:${crypto.randomUUID()}`,
      }));
    }, "Recebimento confirmado e enviado ao Caixa.");
    if (saved) onSaved();
  }
  return <Dialog title="Receber atendimento" modalClassName={modalClassName} layerClassName={layerClassName} onClose={onClose}><form className={styles.form} onSubmit={submit}>
    <Field label="Contraparte / Cliente"><input value={customerName} readOnly /></Field>
    <Field label="Tipo"><input value="Receita" readOnly /></Field>
    <Field label="Descrição" wide><input name="description" defaultValue={receipt.description} required /></Field>
    <Field label="Saldo restante"><input value={(amountCents / 100).toFixed(2).replace(".", ",")} readOnly /></Field>
    <Field label="Valor a receber (R$)"><input name="amount" required inputMode="decimal" defaultValue={(amountCents / 100).toFixed(2).replace(".", ",")} /></Field>
    <Field label="Data do lançamento"><input type="date" value={issueDate} readOnly /></Field>
    <Field label="Vencimento"><input type="date" value={dueDate} readOnly /></Field>
    <Field label="Plano de conta"><select name="chart_account_id" aria-label="Plano de conta" required defaultValue={defaultChart}><option value="" disabled>Selecione</option>{chartAccounts.filter((item) => item.active && item.kind === "REVENUE").map((item) => <option key={item.id} value={item.id}>{item.code ? `${item.code} · ` : ""}{item.name}</option>)}</select></Field>
    <Field label="Banco ou caixa"><select name="financial_account_id" aria-label="Banco ou caixa" required defaultValue={defaultAccount}><option value="" disabled>Selecione</option>{accounts.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
    <Field label="Centro de custo"><select name="cost_center_id" defaultValue=""><option value="">Não informar</option>{costCenters.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
    <Field label="Número do documento"><input name="document_number" defaultValue={documentNumber} required /></Field>
    <Field label="Tags"><select name="tag_ids" aria-label="Tags" multiple size={Math.min(Math.max(activeTags.length, 2), 4)} disabled={activeTags.length === 0}>{activeTags.length === 0 ? <option>Nenhuma tag cadastrada</option> : activeTags.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
    <Field label="Forma de recebimento"><select name="payment_method" defaultValue="CASH"><option value="CASH">Dinheiro</option><option value="PIX">PIX</option><option value="CARD">Cartão</option><option value="TRANSFER">Transferência</option><option value="OTHER">Outro</option></select></Field>
    <Field label="Referência"><input name="reference" placeholder="PIX, NSU ou comprovante" /></Field>
    <div className={`${styles.toolbarGroup} ${styles.formWide}`}><button className={styles.button}>Confirmar recebimento</button><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={onClose}>Cancelar</button></div>
  </form></Dialog>;
}

function EntryDialog({ entry, defaultKind, organizationId, accounts, suppliers, chartAccounts, costCenters, tags, customers, entryTags, demoMode, onClose, onSaved, setMessage }: Omit<CashManagerProps, "section" | "billingStatus" | "balances" | "entries" | "settlements" | "appointmentActivity" | "mappings" | "appointmentReceivables"> & { entry: FinancialEntryRecord | null; defaultKind: EntryKind; onClose: () => void; onSaved: () => void; setMessage: (value: string) => void }) {
  const router = useRouter();
  const [counterpartyKind, setCounterpartyKind] = useState<"" | "CUSTOMER" | "SUPPLIER">(entry?.counterparty_kind ?? "");
  const [kind, setKind] = useState<EntryKind>(entry?.kind ?? defaultKind);
  const [expenseType, setExpenseType] = useState<"SINGLE" | "RECURRING" | "INSTALLMENT">("SINGLE");
  const [recurrence, setRecurrence] = useState<"BIWEEKLY" | "MONTHLY">("MONTHLY");
  const [amount, setAmount] = useState(entry ? (entry.total_cents / 100).toFixed(2).replace(".", ",") : "");
  const [installments, setInstallments] = useState("2");
  const [quickCreate, setQuickCreate] = useState<"CUSTOMER" | "SUPPLIER" | "TAG" | null>(null);
  const selectedTags = new Set(entry ? entryTags.filter((item) => item.entry_id === entry.id).map((item) => item.tag_id) : []);
  const isSeries = !entry && kind === "EXPENSE" && expenseType !== "SINGLE";
  const installmentTotalCents = useMemo(() => {
    try { return centsFromInput(amount) * Math.max(0, Number.parseInt(installments, 10) || 0); } catch { return 0; }
  }, [amount, installments]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blockDemoWrite(demoMode, setMessage)) return;
    const data = new FormData(event.currentTarget);
    const params = { p_description: safeText(data.get("description")), p_issue_date: safeText(data.get("issue_date")), p_due_date: safeText(data.get("due_date")), p_total_cents: centsFromInput(data.get("amount")), p_chart_account_id: safeText(data.get("chart_account_id")), p_cost_center_id: safeText(data.get("cost_center_id")) || null, p_preferred_financial_account_id: safeText(data.get("account_id")) || null, p_counterparty_kind: counterpartyKind || null, p_customer_id: counterpartyKind === "CUSTOMER" ? safeText(data.get("customer_id")) || null : null, p_supplier_id: counterpartyKind === "SUPPLIER" ? safeText(data.get("supplier_id")) || null : null, p_document_number: safeText(data.get("document_number")) || null, p_tag_ids: data.getAll("tag_ids").map(String) };
    const saved = await runMutation(setMessage, async () => {
      if (entry) await assertResult(await connectedClient().rpc("update_financial_entry", { p_entry_id: entry.id, ...params }));
      else if (isSeries) await assertResult(await connectedClient().rpc("create_financial_series", {
        p_organization_id: organizationId,
        p_kind: expenseType === "INSTALLMENT" ? "INSTALLMENT" : "RECURRING",
        p_cadence: expenseType === "INSTALLMENT" ? "MONTHLY" : recurrence,
        p_entry_kind: "EXPENSE",
        p_description: params.p_description,
        p_start_date: params.p_due_date,
        p_chart_account_id: params.p_chart_account_id,
        p_occurrence_count: expenseType === "INSTALLMENT" ? Number.parseInt(installments, 10) : null,
        p_end_date: null,
        p_total_cents: expenseType === "INSTALLMENT" ? installmentTotalCents : null,
        p_amount_cents: expenseType === "RECURRING" ? params.p_total_cents : null,
        p_cost_center_id: params.p_cost_center_id,
        p_location_id: null,
        p_preferred_financial_account_id: params.p_preferred_financial_account_id,
        p_counterparty_kind: params.p_counterparty_kind,
        p_customer_id: params.p_customer_id,
        p_supplier_id: params.p_supplier_id,
        p_document_number: params.p_document_number,
        p_tag_ids: params.p_tag_ids,
      }));
      else await assertResult(await connectedClient().rpc("create_financial_entry", { p_organization_id: organizationId, p_kind: kind, ...params }));
    }, entry ? "Lançamento aberto atualizado." : isSeries ? "Série de despesas criada." : "Lançamento criado.");
    if (saved) onSaved();
  }
  return <Dialog title={entry ? "Editar lançamento" : "Novo lançamento"} onClose={onClose} wide><form className={styles.form} onSubmit={submit}>
    {!entry && defaultKind === "REVENUE" && <Field label="Tipo"><select name="kind" value={kind} onChange={(event) => setKind(event.target.value as EntryKind)}><option value="REVENUE">Receita</option><option value="EXPENSE">Despesa</option></select></Field>}
    {!entry && kind === "EXPENSE" && <Field label="Tipo de despesa"><select value={expenseType} onChange={(event) => setExpenseType(event.target.value as "SINGLE" | "RECURRING" | "INSTALLMENT")}><option value="SINGLE">Única</option><option value="RECURRING">Recorrente</option><option value="INSTALLMENT">Parcelada</option></select></Field>}
    <Field label="Descrição"><input name="description" required defaultValue={entry?.description ?? ""} /></Field>
    <Field label={expenseType === "INSTALLMENT" ? "Valor da parcela (R$)" : isSeries ? "Valor por vencimento (R$)" : "Valor (R$)"}><input name="amount" required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
    <Field label="Data do lançamento"><input type="date" name="issue_date" required defaultValue={entry?.issue_date ?? today()} /></Field>
    {expenseType === "RECURRING" && <Field label="Tipo de recorrência"><select value={recurrence} onChange={(event) => setRecurrence(event.target.value as "BIWEEKLY" | "MONTHLY")}><option value="BIWEEKLY">Quinzenal</option><option value="MONTHLY">Mensal</option></select></Field>}
    {expenseType === "INSTALLMENT" && <Field label="Qtd. de parcelas"><input type="number" min="2" max="360" value={installments} onChange={(event) => setInstallments(event.target.value)} required /></Field>}
    <Field label={isSeries ? "1º vencimento" : "Vencimento"}><input type="date" name="due_date" required defaultValue={entry?.due_date ?? today()} /></Field>
    {expenseType === "INSTALLMENT" && <Field label="Total (R$)"><input value={formatCents(installmentTotalCents)} readOnly /></Field>}
    <Field label="Plano de conta"><select name="chart_account_id" required defaultValue={entry?.chart_account_id ?? ""}><option value="" disabled>Selecione</option>{chartAccounts.filter((item) => item.active && item.kind === kind).map((item) => <option key={item.id} value={item.id}>{item.code ? `${item.code} · ` : ""}{item.name}</option>)}</select></Field>
    <Field label="Banco ou caixa"><select name="account_id" defaultValue={entry?.preferred_financial_account_id ?? ""}><option value="">Definir na liquidação</option>{accounts.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
    <Field label="Centro de custo"><select name="cost_center_id" defaultValue={entry?.cost_center_id ?? ""}><option value="">Não informar</option>{costCenters.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
    <Field label="Número do documento"><input name="document_number" defaultValue={entry?.document_number ?? ""} /></Field>
    <Field label="Contraparte"><select aria-label="Tipo de contraparte" value={counterpartyKind} onChange={(event) => setCounterpartyKind(event.target.value as "" | "CUSTOMER" | "SUPPLIER")}><option value="">Não informar</option><option value="CUSTOMER">Cliente</option><option value="SUPPLIER">Fornecedor</option></select></Field>
    {counterpartyKind === "CUSTOMER" && <Field label="Cliente"><select name="customer_id" defaultValue={entry?.customer_id ?? ""}><option value="">Selecione</option>{customers.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}</select><button className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} type="button" onClick={() => setQuickCreate("CUSTOMER")}>Novo cliente</button></Field>}
    {counterpartyKind === "SUPPLIER" && <Field label="Fornecedor"><select name="supplier_id" defaultValue={entry?.supplier_id ?? ""}><option value="">Selecione</option>{suppliers.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} type="button" onClick={() => setQuickCreate("SUPPLIER")}>Novo fornecedor</button></Field>}
    <Field label="Tags" wide><select name="tag_ids" multiple defaultValue={[...selectedTags]}>{tags.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} type="button" onClick={() => setQuickCreate("TAG")}>Nova tag</button></Field>
    <div className={`${styles.toolbarGroup} ${styles.formWide}`}><button className={styles.button}>{entry ? "Salvar" : "Adicionar"}</button><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={onClose}>Cancelar</button></div>
  </form>{quickCreate && <QuickFinancialCatalogDialog kind={quickCreate} organizationId={organizationId} demoMode={demoMode} onClose={() => setQuickCreate(null)} onCreated={() => { setQuickCreate(null); router.refresh(); }} setMessage={setMessage} />}</Dialog>;
}

function QuickFinancialCatalogDialog({ kind, organizationId, demoMode, onClose, onCreated, setMessage }: { kind: "CUSTOMER" | "SUPPLIER" | "TAG"; organizationId: string; demoMode?: boolean; onClose: () => void; onCreated: () => void; setMessage: (value: string) => void }) {
  const title = kind === "CUSTOMER" ? "Novo cliente" : kind === "SUPPLIER" ? "Novo fornecedor" : "Nova tag";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blockDemoWrite(demoMode, setMessage)) return;
    const name = safeText(new FormData(event.currentTarget).get("name"));
    const saved = await runMutation(setMessage, async () => {
      if (kind === "SUPPLIER") await assertResult(await connectedClient().rpc("save_supplier", { p_organization_id: organizationId, p_id: null, p_person_kind: "COMPANY", p_name: name, p_document: null, p_phone_e164: null, p_email: null, p_address: {}, p_notes: null }));
      else if (kind === "TAG") await assertResult(await connectedClient().rpc("save_financial_tag", { p_organization_id: organizationId, p_id: null, p_name: name, p_color: null }));
      else await assertResult(await connectedClient().from("customers").insert({ organization_id: organizationId, full_name: name, phone_e164: null, email: null, birth_date: null, notes: null }));
    }, `${title} criado.`);
    if (saved) onCreated();
  }
  return <Dialog title={title} onClose={onClose}><form className={styles.form} onSubmit={submit}><Field label="Nome"><input name="name" required autoFocus /></Field><div className={`${styles.toolbarGroup} ${styles.formWide}`}><button className={styles.button}>Salvar</button><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={onClose}>Cancelar</button></div></form></Dialog>;
}

function SettlementDialog({ entry, accounts, demoMode, onClose, onSaved, setMessage }: { entry: FinancialEntryRecord; accounts: FinancialAccountRecord[]; demoMode?: boolean; onClose: () => void; onSaved: () => void; setMessage: (value: string) => void }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (blockDemoWrite(demoMode, setMessage)) return; const data = new FormData(event.currentTarget);
    const saved = await runMutation(setMessage, async () => { await assertResult(await connectedClient().rpc("settle_financial_entry", { p_entry_id: entry.id, p_financial_account_id: safeText(data.get("account_id")), p_amount_cents: centsFromInput(data.get("amount")), p_settled_on: safeText(data.get("settled_on")), p_payment_method: safeText(data.get("payment_method")), p_reference: safeText(data.get("reference")), p_idempotency_key: `manager:cash-settlement:${crypto.randomUUID()}` })); }, "Liquidação registrada no ledger.");
    if (saved) onSaved();
  }
  return <Dialog title="Liquidar lançamento" onClose={onClose}><form className={styles.form} onSubmit={submit}><p className={styles.formWide}>Saldo restante: <strong>{formatCents(entry.remaining_cents)}</strong></p><Field label="Conta"><select name="account_id" required defaultValue={entry.preferred_financial_account_id ?? ""}><option value="" disabled>Selecione</option>{accounts.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Valor (R$)"><input name="amount" required inputMode="decimal" defaultValue={(entry.remaining_cents / 100).toFixed(2).replace(".", ",")} /></Field><Field label="Data de pagamento/recebimento"><input type="date" name="settled_on" required defaultValue={today()} /></Field><Field label="Método"><select name="payment_method"><option value="PIX">PIX</option><option value="CARD">Cartão</option><option value="CASH">Dinheiro</option><option value="BOLETO">Boleto</option><option value="TRANSFER">Transferência</option><option value="OTHER">Outro</option></select></Field><Field label="Referência" wide><input name="reference" required placeholder="Comprovante, NSU ou protocolo" /></Field><div className={`${styles.toolbarGroup} ${styles.formWide}`}><button className={styles.button}>Confirmar liquidação</button><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={onClose}>Cancelar</button></div></form></Dialog>;
}

function TransferDialog({ accounts, demoMode, onClose, onSaved, setMessage }: { accounts: FinancialAccountRecord[]; demoMode?: boolean; onClose: () => void; onSaved: () => void; setMessage: (value: string) => void }) {
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (blockDemoWrite(demoMode, setMessage)) return; const data = new FormData(event.currentTarget); const saved = await runMutation(setMessage, async () => { await assertResult(await connectedClient().rpc("create_financial_transfer", { p_source_financial_account_id: safeText(data.get("source")), p_destination_financial_account_id: safeText(data.get("destination")), p_amount_cents: centsFromInput(data.get("amount")), p_transferred_on: safeText(data.get("date")), p_description: safeText(data.get("description")), p_reference: safeText(data.get("reference")), p_idempotency_key: `manager:cash-transfer:${crypto.randomUUID()}` })); }, "Transferência criada em duas pontas atômicas."); if (saved) onSaved(); }
  return <Dialog title="Transferir entre contas" onClose={onClose}><form className={styles.form} onSubmit={submit}><Field label="Origem"><select name="source" required><option value="">Selecione</option>{accounts.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Destino"><select name="destination" required><option value="">Selecione</option>{accounts.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Valor (R$)"><input name="amount" required inputMode="decimal" /></Field><Field label="Data"><input name="date" type="date" required defaultValue={today()} /></Field><Field label="Descrição" wide><input name="description" required placeholder="Ex.: reforço do caixa" /></Field><Field label="Referência" wide><input name="reference" /></Field><div className={`${styles.toolbarGroup} ${styles.formWide}`}><button className={styles.button}>Confirmar transferência</button><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={onClose}>Cancelar</button></div></form></Dialog>;
}

function AccountsSection({ organizationId, accounts, mappings, demoMode, balanceById, setMessage }: Pick<CashManagerProps, "organizationId" | "accounts" | "mappings" | "demoMode"> & { balanceById: Map<string, number>; accountById: Map<string, FinancialAccountRecord>; setMessage: (value: string) => void }) {
  const router = useRouter(); const [accountEditor, setAccountEditor] = useState<FinancialAccountRecord | "new" | null>(null);
  const editing = accountEditor && accountEditor !== "new" ? accountEditor : null;
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (blockDemoWrite(demoMode, setMessage)) return; const data = new FormData(event.currentTarget); const saved = await runMutation(setMessage, async () => { await assertResult(await connectedClient().rpc("save_financial_account", { p_organization_id: organizationId, p_id: editing?.id ?? null, p_kind: safeText(data.get("kind")), p_name: safeText(data.get("name")), p_opening_balance_cents: centsFromInput(data.get("opening")), p_bank_code: safeText(data.get("bank_code")) || null, p_branch: safeText(data.get("branch")) || null, p_account_number: safeText(data.get("number")) || null, p_description: safeText(data.get("description")) || null })); }, editing ? "Conta atualizada." : "Conta criada."); if (saved) { setAccountEditor(null); router.refresh(); } }
  async function mapAccount(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (blockDemoWrite(demoMode, setMessage)) return; const data = new FormData(event.currentTarget); const saved = await runMutation(setMessage, async () => { await assertResult(await connectedClient().rpc("configure_payment_account_mapping", { p_provider: safeText(data.get("provider")), p_payment_mode: safeText(data.get("payment_mode")), p_financial_account_id: safeText(data.get("account_id")) })); }, "Mapeamento de recebimento salvo."); if (saved) router.refresh(); }
  async function toggleActive(account: FinancialAccountRecord) { if (blockDemoWrite(demoMode, setMessage)) return; const saved = await runMutation(setMessage, async () => { await assertResult(await connectedClient().rpc("set_financial_catalog_active", { p_catalog: "ACCOUNT", p_id: account.id, p_active: !account.active })); }, account.active ? "Conta inativada; histórico preservado." : "Conta reativada."); if (saved) router.refresh(); }
  return <>
    <div className={styles.grid}>
    <Panel title="Bancos" description="Inative em vez de apagar contas usadas." className={styles.span12}>
      <div className={styles.toolbarGroup}><button className={styles.button} type="button" onClick={() => setAccountEditor("new")}><Plus size={16} /> Adicionar conta</button></div>
      {!accounts.length ? <EmptyState title="Sem contas">Cadastre banco ou caixa físico antes de liquidar lançamentos.</EmptyState> : <div className={styles.list}>{accounts.map((item) => <article className={styles.row} key={item.id}>
        <span className={styles.rowTitle}><strong>{item.name}</strong><small>{item.kind === "BANK" ? "Banco" : "Caixa físico"} · saldo inicial {formatCents(item.opening_balance_cents)}{item.description ? ` · ${item.description}` : ""}</small></span>
        <strong>{formatCents(balanceById.get(item.id) ?? item.opening_balance_cents)}</strong><StatusChip active={item.active} /><span />
        <span className={styles.rowActions}><button className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} type="button" onClick={() => setAccountEditor(item)}>Editar</button><button className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} type="button" onClick={() => void toggleActive(item)}>{item.active ? "Inativar" : "Reativar"}</button></span>
      </article>)}</div>}
    </Panel>
    {SHOW_APPOINTMENT_RECEIPT_MAPPINGS && <Panel title="Recebimentos de agendamento" description="Define a conta padrão por provedor e modalidade." className={styles.span12}>
      <form className={styles.form} onSubmit={mapAccount}>
        <Field label="Provedor"><select name="provider"><option value="MANUAL">Manual</option><option value="MERCADO_PAGO">Mercado Pago</option></select></Field>
        <Field label="Modalidade"><select name="payment_mode"><option value="COUNTER">Balcão</option><option value="DEPOSIT">Sinal</option><option value="FULL">Integral</option></select></Field>
        <Field label="Conta destino" wide><select name="account_id" required><option value="">Selecione</option>{accounts.filter((item) => item.active).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></Field>
        <div className={`${styles.toolbarGroup} ${styles.formWide}`}><button className={styles.button}>Salvar mapeamento</button></div>
      </form>
      {mappings.length > 0 && <p className={styles.muted}>{mappings.length} mapeamento(s) configurado(s).</p>}
    </Panel>}
    </div>
    {accountEditor && <FinancialAccountDialog account={editing} onClose={() => setAccountEditor(null)} onSubmit={submit} />}
  </>;
}

function FinancialAccountDialog({ account, onClose, onSubmit }: { account: FinancialAccountRecord | null; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <Dialog title={account ? "Editar conta" : "Adicionar conta"} onClose={onClose} wide><form className={styles.form} onSubmit={onSubmit}>
    <Field label="Tipo"><select name="kind" defaultValue={account?.kind ?? "BANK"}><option value="BANK">Banco</option><option value="CASH">Caixa físico</option></select></Field>
    <Field label="Nome"><input name="name" required defaultValue={account?.name ?? ""} /></Field>
    <Field label="Saldo inicial (R$)"><input name="opening" required inputMode="decimal" defaultValue={account ? (account.opening_balance_cents / 100).toFixed(2).replace(".", ",") : "0,00"} /></Field>
    <Field label="Código do banco"><input name="bank_code" defaultValue={account?.bank_code ?? ""} /></Field>
    <Field label="Agência"><input name="branch" defaultValue={account?.branch ?? ""} /></Field>
    <Field label="Conta"><input name="number" defaultValue={account?.account_number ?? ""} /></Field>
    <Field label="Descrição da conta" wide><textarea name="description" defaultValue={account?.description ?? ""} /></Field>
    <div className={`${styles.toolbarGroup} ${styles.formWide}`}><button className={styles.button}>{account ? "Salvar" : "Adicionar conta"}</button><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={onClose}>Cancelar</button></div>
  </form></Dialog>;
}

function SuppliersSection({ organizationId, suppliers, demoMode, setMessage }: { organizationId: string; suppliers: SupplierRecord[]; demoMode?: boolean; setMessage: (value: string) => void }) {
  const router = useRouter(); const [editing, setEditing] = useState<SupplierRecord | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (blockDemoWrite(demoMode, setMessage)) return; const data = new FormData(event.currentTarget); const saved = await runMutation(setMessage, async () => { await assertResult(await connectedClient().rpc("save_supplier", { p_organization_id: organizationId, p_id: editing?.id ?? null, p_person_kind: safeText(data.get("person_kind")), p_name: safeText(data.get("name")), p_document: safeText(data.get("document")) || null, p_phone_e164: safeText(data.get("phone")) || null, p_email: safeText(data.get("email")) || null, p_address: {}, p_notes: safeText(data.get("notes")) || null })); }, editing ? "Fornecedor atualizado." : "Fornecedor criado."); if (saved) { setEditing(null); router.refresh(); } }
  async function toggleActive(supplier: SupplierRecord) { if (blockDemoWrite(demoMode, setMessage)) return; const saved = await runMutation(setMessage, async () => { await assertResult(await connectedClient().rpc("set_financial_catalog_active", { p_catalog: "SUPPLIER", p_id: supplier.id, p_active: !supplier.active })); }, supplier.active ? "Fornecedor inativado; histórico preservado." : "Fornecedor reativado."); if (saved) router.refresh(); }
  return <div className={styles.grid}>
    <Panel title={editing ? "Editar fornecedor" : "Novo fornecedor"} className={styles.span5}>
      <form className={styles.form} onSubmit={submit}>
        <Field label="Tipo"><select name="person_kind" defaultValue={editing?.person_kind ?? "COMPANY"}><option value="COMPANY">Pessoa jurídica</option><option value="INDIVIDUAL">Pessoa física</option></select></Field>
        <Field label="Nome"><input name="name" required defaultValue={editing?.name ?? ""} /></Field>
        <Field label="CPF/CNPJ"><input name="document" defaultValue={editing?.document ?? ""} /></Field>
        <Field label="Telefone"><input name="phone" defaultValue={editing?.phone_e164 ?? ""} placeholder="+5511999999999" /></Field>
        <Field label="E-mail"><input name="email" type="email" defaultValue={editing?.email ?? ""} /></Field>
        <Field label="Observações" wide><textarea name="notes" defaultValue={editing?.notes ?? ""} /></Field>
        <div className={`${styles.toolbarGroup} ${styles.formWide}`}><button className={styles.button}>{editing ? "Salvar" : "Adicionar"}</button>{editing && <button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => setEditing(null)}>Cancelar</button>}</div>
      </form>
    </Panel>
    <Panel title="Fornecedores" description="Usados nas despesas e mantidos no histórico." className={styles.span7}>
      {!suppliers.length ? <EmptyState title="Sem fornecedores">Cadastre fornecedores antes de lançar despesas vinculadas.</EmptyState> : <div className={styles.list}>{suppliers.map((supplier) => <article key={supplier.id} className={styles.row}>
        <span className={styles.rowTitle}><strong>{supplier.name}</strong><small>{supplier.document ?? "Sem documento"} · {supplier.email ?? "Sem e-mail"}</small></span>
        <span>{supplier.person_kind === "COMPANY" ? "PJ" : "PF"}</span><StatusChip active={supplier.active} /><span />
        <span className={styles.rowActions}><button type="button" className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} onClick={() => setEditing(supplier)}>Editar</button><button type="button" className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} onClick={() => void toggleActive(supplier)}>{supplier.active ? "Inativar" : "Reativar"}</button></span>
      </article>)}</div>}
    </Panel>
  </div>;
}

type CatalogKind = "chart" | "cost" | "tag";

type ChartAccountTreeItem = ChartAccountRecord & { depth: number };

function chartAccountLabel(account: ChartAccountRecord) {
  return account.code ? `${account.code} · ${account.name}` : account.name;
}

function compareChartAccounts(left: ChartAccountRecord, right: ChartAccountRecord) {
  const leftCode = left.code?.trim() ?? "";
  const rightCode = right.code?.trim() ?? "";
  if (!leftCode || !rightCode) {
    if (leftCode) return -1;
    if (rightCode) return 1;
    return left.name.localeCompare(right.name, "pt-BR");
  }
  const leftParts = leftCode.split(".").map(Number);
  const rightParts = rightCode.split(".").map(Number);
  if (leftParts.every(Number.isFinite) && rightParts.every(Number.isFinite)) {
    for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
      const difference = (leftParts[index] ?? -1) - (rightParts[index] ?? -1);
      if (difference) return difference;
    }
  }
  return leftCode.localeCompare(rightCode, "pt-BR", { numeric: true }) || left.name.localeCompare(right.name, "pt-BR");
}

export function buildChartAccountTree(items: ChartAccountRecord[]): ChartAccountTreeItem[] {
  const itemIds = new Set(items.map((item) => item.id));
  const childrenByParent = new Map<string | null, ChartAccountRecord[]>();
  items.forEach((item) => {
    const parentId = item.parent_id && itemIds.has(item.parent_id) ? item.parent_id : null;
    childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), item]);
  });
  const visit = (parentId: string | null, depth: number, ancestors: ReadonlySet<string>): ChartAccountTreeItem[] => (childrenByParent.get(parentId) ?? [])
    .sort(compareChartAccounts)
    .flatMap((item) => ancestors.has(item.id) ? [] : [{ ...item, depth }, ...visit(item.id, depth + 1, new Set([...ancestors, item.id]))]);
  return visit(null, 0, new Set());
}

function CatalogsSection({ organizationId, chartAccounts, costCenters, tags, accounts, mappings, demoMode, setMessage }: Pick<CashManagerProps, "chartAccounts" | "costCenters" | "tags" | "accounts" | "mappings" | "demoMode"> & { organizationId: string; setMessage: (value: string) => void }) {
  const router = useRouter();
  const [editingChart, setEditingChart] = useState<ChartAccountRecord | null>(null);
  const [chartKind, setChartKind] = useState<ChartAccountRecord["kind"]>("REVENUE");
  const [editingCost, setEditingCost] = useState<CostCenterRecord | null>(null);
  const [editingTag, setEditingTag] = useState<FinancialTagRecord | null>(null);
  const chartParentOptions = buildChartAccountTree(chartAccounts.filter((item) => item.active && item.kind === chartKind && item.id !== editingChart?.id));

  function editChart(account: ChartAccountRecord) {
    setEditingChart(account);
    setChartKind(account.kind);
  }

  function cancelChartEdit() {
    setEditingChart(null);
    setChartKind("REVENUE");
  }

  async function submitCatalog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blockDemoWrite(demoMode, setMessage)) return;
    const data = new FormData(event.currentTarget);
    const catalog = safeText(data.get("catalog")) as CatalogKind;
    const rpc = catalog === "chart" ? "save_chart_of_account" : catalog === "cost" ? "save_cost_center" : "save_financial_tag";
    const params = catalog === "chart"
      ? { p_organization_id: organizationId, p_id: editingChart?.id ?? null, p_parent_id: safeText(data.get("parent_id")) || null, p_code: safeText(data.get("code")) || null, p_name: safeText(data.get("name")), p_kind: safeText(data.get("kind")) }
      : catalog === "cost"
        ? { p_organization_id: organizationId, p_id: editingCost?.id ?? null, p_name: safeText(data.get("name")) }
        : { p_organization_id: organizationId, p_id: editingTag?.id ?? null, p_name: safeText(data.get("name")), p_color: safeText(data.get("color")) || null };
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc(rpc, params));
      if (catalog === "chart" && editingChart) await assertResult(await connectedClient().rpc("set_chart_account_reporting_classification", {
        p_chart_account_id: editingChart.id,
        p_dre_group: safeText(data.get("dre_group")) || null,
        p_cash_flow_activity: safeText(data.get("cash_flow_activity")) || null,
      }));
    }, "Cadastro financeiro salvo.");
    if (saved) { cancelChartEdit(); setEditingCost(null); setEditingTag(null); router.refresh(); }
  }

  async function toggleCatalog(catalog: CatalogKind, item: { id: string; active: boolean }) {
    if (blockDemoWrite(demoMode, setMessage)) return;
    const rpcCatalog = catalog === "chart" ? "CHART_ACCOUNT" : catalog === "cost" ? "COST_CENTER" : "TAG";
    const saved = await runMutation(setMessage, async () => { await assertResult(await connectedClient().rpc("set_financial_catalog_active", { p_catalog: rpcCatalog, p_id: item.id, p_active: !item.active })); }, item.active ? "Item inativado; histórico preservado." : "Item reativado.");
    if (saved) router.refresh();
  }

  return <div className={styles.grid}>
    <Panel title={editingChart ? "Editar plano de contas" : "Plano de contas"} description="Crie grupos e subcontas por receita ou despesa." className={styles.span12}>
      <form className={styles.form} key={`chart-${editingChart?.id ?? "new"}`} onSubmit={submitCatalog}>
        <input type="hidden" name="catalog" value="chart" />
        <Field label="Código"><input name="code" defaultValue={editingChart?.code ?? ""} /></Field>
        <Field label="Nome"><input name="name" required defaultValue={editingChart?.name ?? ""} /></Field>
        <Field label="Natureza"><select name="kind" value={chartKind} onChange={(event) => setChartKind(event.target.value as ChartAccountRecord["kind"])}><option value="REVENUE">Receita</option><option value="EXPENSE">Despesa</option></select></Field>
        <Field label="Conta superior"><select name="parent_id" defaultValue={editingChart?.parent_id ?? ""}><option value="">Nenhuma</option>{chartParentOptions.map((item) => <option key={item.id} value={item.id}>{`${"  ".repeat(item.depth)}${chartAccountLabel(item)}`}</option>)}</select></Field>
        {editingChart && <><Field label="Grupo DRE"><select name="dre_group" defaultValue={editingChart.dre_group ?? ""}><option value="">Não classificado</option><option value="GROSS_REVENUE">Receita bruta</option><option value="REVENUE_DEDUCTIONS">Deduções da receita</option><option value="SERVICE_COST">Custo do serviço</option><option value="OPERATING_EXPENSE">Despesa operacional</option><option value="FINANCIAL_RESULT">Resultado financeiro</option><option value="OTHER_RESULT">Outros resultados</option><option value="INCOME_TAX">Imposto sobre resultado</option></select></Field><Field label="Atividade DFC"><select name="cash_flow_activity" defaultValue={editingChart.cash_flow_activity ?? ""}><option value="">Não classificado</option><option value="OPERATING">Operacional</option><option value="INVESTING">Investimento</option><option value="FINANCING">Financiamento</option></select></Field></>}
        <div className={`${styles.toolbarGroup} ${styles.formWide}`}><button className={styles.button}><ReceiptText size={15} /> {editingChart ? "Salvar" : "Adicionar conta"}</button>{editingChart && <button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={cancelChartEdit}>Cancelar</button>}</div>
      </form>
      <ChartAccountColumns accounts={chartAccounts} onEdit={editChart} onToggle={(item) => void toggleCatalog("chart", item)} />
    </Panel>
    <Panel title={editingCost ? "Editar centro de custo" : "Centro de custo"} description="Classifique responsabilidade operacional." className={styles.span12}>
      <form className={styles.form} key={`cost-${editingCost?.id ?? "new"}`} onSubmit={submitCatalog}>
        <input type="hidden" name="catalog" value="cost" />
        <Field label="Nome" wide><input name="name" required defaultValue={editingCost?.name ?? ""} /></Field>
        <div className={`${styles.toolbarGroup} ${styles.formWide}`}><button className={styles.button}><Building2 size={15} /> {editingCost ? "Salvar" : "Adicionar centro"}</button>{editingCost && <button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => setEditingCost(null)}>Cancelar</button>}</div>
      </form>
      <CatalogRows items={costCenters} onEdit={setEditingCost} onToggle={(item) => void toggleCatalog("cost", item)} />
    </Panel>
    <Panel title={editingTag ? "Editar tag" : "Tags"} description="Marcadores complementares para filtros futuros." className={styles.span6}>
      <form className={styles.form} key={`tag-${editingTag?.id ?? "new"}`} onSubmit={submitCatalog}>
        <input type="hidden" name="catalog" value="tag" />
        <Field label="Nome"><input name="name" required defaultValue={editingTag?.name ?? ""} /></Field>
        <Field label="Cor"><input name="color" placeholder="#2f6b5d" defaultValue={editingTag?.color ?? ""} /></Field>
        <div className={`${styles.toolbarGroup} ${styles.formWide}`}><button className={styles.button}><Tags size={15} /> {editingTag ? "Salvar" : "Adicionar tag"}</button>{editingTag && <button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => setEditingTag(null)}>Cancelar</button>}</div>
      </form>
      <CatalogRows items={tags} onEdit={setEditingTag} onToggle={(item) => void toggleCatalog("tag", item)} />
    </Panel>
    <Panel title="Estrutura financeira" description="Cadastre contas e fornecedores nas seções próprias." className={styles.span6}><div className={styles.cards}><article className={styles.card}><Landmark size={20} /><strong>{accounts.length} contas</strong><small>Bancos e caixas físicos</small><Link href="/gestor/financeiro/bancos" className={`${styles.button} ${styles.buttonSoft}`}>Gerenciar</Link></article>{SHOW_APPOINTMENT_RECEIPT_MAPPINGS && <article className={styles.card}><CircleDollarSign size={20} /><strong>{mappings.length} mapeamentos</strong><small>Recebimentos de agendamento</small><Link href="/gestor/financeiro/bancos" className={`${styles.button} ${styles.buttonSoft}`}>Configurar</Link></article>}</div></Panel>
  </div>;
}

function ChartAccountColumns({ accounts, onEdit, onToggle }: { accounts: ChartAccountRecord[]; onEdit: (item: ChartAccountRecord) => void; onToggle: (item: ChartAccountRecord) => void }) {
  return <div className={styles.chartColumns}>
    <ChartAccountColumn title="Receitas" buttonLabel="receitas" accounts={buildChartAccountTree(accounts.filter((item) => item.kind === "REVENUE"))} onEdit={onEdit} onToggle={onToggle} />
    <ChartAccountColumn title="Despesas" buttonLabel="despesas" accounts={buildChartAccountTree(accounts.filter((item) => item.kind === "EXPENSE"))} onEdit={onEdit} onToggle={onToggle} />
  </div>;
}

function ChartAccountColumn({ title, buttonLabel, accounts, onEdit, onToggle }: { title: string; buttonLabel: string; accounts: ChartAccountTreeItem[]; onEdit: (item: ChartAccountRecord) => void; onToggle: (item: ChartAccountRecord) => void }) {
  const [expanded, setExpanded] = useState(false);
  const listId = `chart-accounts-${buttonLabel}`;
  const actionLabel = `${expanded ? "Ocultar" : "Mostrar"} planos de ${buttonLabel}`;
  return <section className={styles.chartColumn} aria-labelledby={`${listId}-title`}>
    <div className={styles.chartColumnHeader}>
      <div><h3 id={`${listId}-title`}>{title}</h3><small>{accounts.length} plano(s)</small></div>
      <button className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} type="button" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded((current) => !current)}>{actionLabel}</button>
    </div>
    {expanded && <ul id={listId} className={styles.chartList} aria-label={`Planos de ${buttonLabel}`}>
      {accounts.map((item) => <li key={item.id} className={styles.chartListItem} style={{ paddingLeft: `${.75 + item.depth * 1.1}rem` }}>
        <article className={styles.chartRow}>
          <span className={styles.rowTitle}><strong>{chartAccountLabel(item)}</strong><small>{item.depth ? "Subconta" : "Conta principal"}</small></span>
          <StatusChip active={item.active} />
          <span className={styles.rowActions}><button type="button" className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} onClick={() => onEdit(item)}>Editar</button><button type="button" className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} onClick={() => onToggle(item)}>{item.active ? "Inativar" : "Reativar"}</button></span>
        </article>
      </li>)}
    </ul>}
  </section>;
}

function CatalogRows<T extends { id: string; name: string; active: boolean }>({ items, onEdit, onToggle }: { items: T[]; onEdit: (item: T) => void; onToggle: (item: T) => void }) {
  return !items.length ? <p className={styles.muted}>Nenhum item cadastrado.</p> : <div className={styles.list}>{items.map((item) => <article className={styles.row} key={item.id}><span className={styles.rowTitle}><strong>{item.name}</strong></span><StatusChip active={item.active} /><span /><span /><span className={styles.rowActions}><button type="button" className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} onClick={() => onEdit(item)}>Editar</button><button type="button" className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} onClick={() => onToggle(item)}>{item.active ? "Inativar" : "Reativar"}</button></span></article>)}</div>;
}

function Dialog({ title, children, onClose, wide = false, modalClassName = "", layerClassName = "" }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean; modalClassName?: string; layerClassName?: string }) { const titleId = `dialog-${title.replaceAll(/\s+/gu, "-").toLocaleLowerCase("pt-BR")}`; return <div className={`${styles.modalLayer} ${layerClassName}`} role="presentation"><button type="button" className={styles.modalBackdrop} aria-label="Fechar" onClick={onClose} /><section className={`${styles.modal} ${wide ? styles.modalWide : ""} ${modalClassName}`} role="dialog" aria-modal="true" aria-labelledby={titleId}><div className={styles.modalHeader}><h2 id={titleId}>{title}</h2><button className={styles.modalClose} type="button" onClick={onClose} aria-label={`Fechar ${title}`}><X size={18} /></button></div>{children}</section></div>; }

function ConfirmDialog({ title, description, confirmLabel, onClose, onConfirm }: { title: string; description: string; confirmLabel: string; onClose: () => void; onConfirm: () => void }) { return <Dialog title={title} onClose={onClose}><p>{description}</p><div className={styles.toolbarGroup}><button className={`${styles.button} ${styles.buttonDanger}`} type="button" onClick={onConfirm}>{confirmLabel}</button><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={onClose}>Cancelar</button></div></Dialog>; }
