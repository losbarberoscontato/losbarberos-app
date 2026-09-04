"use client";

import { useMemo, useState } from "react";
import { Download, Printer } from "lucide-react";
import type { loadFinancialReportsData } from "./server";
import type { AwaitedReturn } from "./utility-types";
import type { FinancialFactBasis, FinancialReportType } from "./types";
import { formatCents } from "./format";
import { FinanceSubnav } from "./cash-manager";
import { EmptyState, Panel, StatusChip } from "./shared";
import { PageHeader } from "@/components/ui";
import styles from "./connected-manager.module.css";

type Props = AwaitedReturn<typeof loadFinancialReportsData>;
type BasisFilter = "ALL" | FinancialFactBasis;

const reportTabs: Array<{ id: FinancialReportType; label: string }> = [
  { id: "DASHBOARD", label: "Dashboard" }, { id: "PAYABLES", label: "Contas a pagar" },
  { id: "RECEIVABLES", label: "Contas a receber" }, { id: "CUSTOMERS", label: "Por cliente" },
  { id: "FORECAST", label: "Previsão" },
  { id: "CASH_FLOW", label: "Fluxo de caixa" }, { id: "INCOME_STATEMENT", label: "DRE" }, { id: "BUDGET", label: "Orçamento" },
];

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${(/^[=+\-@]/u.test(text) ? `'${text}` : text).replaceAll('"', '""')}"`;
}

function sum(rows: Props["facts"]) { return rows.reduce((total, row) => total + row.signed_cents, 0); }

export function FinancialReportsManager(props: Props & { initialReport?: FinancialReportType }) {
  const [report, setReport] = useState<FinancialReportType>(props.initialReport ?? "DASHBOARD");
  const [basis, setBasis] = useState<BasisFilter>("ALL");
  const [start, setStart] = useState(props.from);
  const [end, setEnd] = useState(props.to);
  const [customerId, setCustomerId] = useState("");
  const [barberId, setBarberId] = useState("");
  const [service, setService] = useState("");
  const [chartId, setChartId] = useState("");
  const [centerId, setCenterId] = useState("");
  const [locationId, setLocationId] = useState("");

  const filtered = useMemo(() => props.facts.filter((row) =>
    (!start || row.fact_date >= start) && (!end || row.fact_date <= end) &&
    (basis === "ALL" || row.basis === basis) && (!customerId || row.customer_id === customerId) &&
    (!barberId || row.barber_id === barberId) && (!service || row.service_id === service) &&
    (!chartId || row.chart_account_id === chartId) && (!centerId || row.cost_center_id === centerId) && (!locationId || row.location_id === locationId),
  ), [props.facts, start, end, basis, customerId, barberId, service, chartId, centerId, locationId]);

  const byBasis = useMemo(() => ({
    accrual: sum(filtered.filter((row) => row.basis === "ACCRUAL")),
    cash: sum(filtered.filter((row) => row.basis === "CASH")),
    forecast: sum(filtered.filter((row) => row.basis === "FORECAST")),
    unclassified: filtered.filter((row) => !row.dre_group).length,
  }), [filtered]);
  const customers = useMemo(() => group(filtered.filter((row) => row.basis === "CASH" && row.customer_id), (row) => props.customers.find((item) => item.id === row.customer_id)?.full_name ?? "Cliente"), [filtered, props.customers]);
  const commissions = useMemo(() => group(filtered.filter((row) => row.source_type === "COMMISSION" || row.source_type === "COMMISSION_PAYOUT"), (row) => props.barbers.find((item) => item.id === row.barber_id)?.display_name ?? "Profissional"), [filtered, props.barbers]);
  const dre = useMemo(() => group(filtered.filter((row) => row.basis === "ACCRUAL"), (row) => row.dre_group ?? "Não classificado"), [filtered]);
  const cashFlow = useMemo(() => group(filtered.filter((row) => row.basis === "CASH"), (row) => row.cash_flow_activity ?? "Não classificado"), [filtered]);

  function exportCsv() {
    const header = ["base", "origem", "data", "competencia", "vencimento", "cliente", "profissional", "servico", "valor_centavos", "status"];
    const rows = filtered.map((row) => [row.basis, row.source_type, row.fact_date, row.competence_date, row.due_date, props.customers.find((item) => item.id === row.customer_id)?.full_name ?? "", props.barbers.find((item) => item.id === row.barber_id)?.display_name ?? "", row.service_name_snapshot ?? "", row.signed_cents, row.status]);
    const url = URL.createObjectURL(new Blob([[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `los-barberos-${report.toLowerCase()}-${start}-${end}.csv`; anchor.click(); URL.revokeObjectURL(url);
  }

  return <div className={styles.stack}>
    <PageHeader title="Relatórios financeiros" description="Visão gerencial por competência e caixa. Não substitui escrituração contábil oficial." actions={<div className={styles.toolbarGroup}><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => window.print()}><Printer size={16} /> Imprimir/PDF</button><button className={styles.button} type="button" onClick={exportCsv}><Download size={16} /> CSV</button></div>} />
    <FinanceSubnav active={props.initialReport === "COMMISSIONS" ? "commissions" : "reports"} />
    {props.initialReport !== "COMMISSIONS" && <nav className={styles.tabs} aria-label="Relatórios financeiros">{reportTabs.map((tab) => <button key={tab.id} type="button" className={`${styles.tab} ${report === tab.id ? styles.tabActive : ""}`} onClick={() => setReport(tab.id)}>{tab.label}</button>)}</nav>}
    <section className={styles.toolbar}>
      <div className={styles.toolbarGroup}>
        <input className={styles.packageFilterSelect} type="date" aria-label="Data inicial" value={start} onChange={(event) => setStart(event.target.value)} />
        <input className={styles.packageFilterSelect} type="date" aria-label="Data final" value={end} onChange={(event) => setEnd(event.target.value)} />
        <select className={styles.packageFilterSelect} aria-label="Base" value={basis} onChange={(event) => setBasis(event.target.value as BasisFilter)}><option value="ALL">Todas bases</option><option value="ACCRUAL">Competência</option><option value="CASH">Caixa</option><option value="FORECAST">Previsão</option></select>
        <select className={styles.packageFilterSelect} aria-label="Cliente" value={customerId} onChange={(event) => setCustomerId(event.target.value)}><option value="">Todos clientes</option>{props.customers.map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}</select>
        <select className={styles.packageFilterSelect} aria-label="Profissional" value={barberId} onChange={(event) => setBarberId(event.target.value)}><option value="">Todos profissionais</option>{props.barbers.map((item) => <option key={item.id} value={item.id}>{item.display_name}</option>)}</select>
        <select className={styles.packageFilterSelect} aria-label="Serviço" value={service} onChange={(event) => setService(event.target.value)}><option value="">Todos serviços</option>{[...new Map(props.facts.filter((item) => item.service_id && item.service_name_snapshot).map((item) => [item.service_id!, item.service_name_snapshot!])).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
        <select className={styles.packageFilterSelect} aria-label="Plano de conta" value={chartId} onChange={(event) => setChartId(event.target.value)}><option value="">Todos planos</option>{props.chartAccounts.map((item) => <option key={item.id} value={item.id}>{item.code ? `${item.code} · ` : ""}{item.name}</option>)}</select>
        <select className={styles.packageFilterSelect} aria-label="Centro de custo" value={centerId} onChange={(event) => setCenterId(event.target.value)}><option value="">Todos centros</option>{props.costCenters.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select className={styles.packageFilterSelect} aria-label="Unidade" value={locationId} onChange={(event) => setLocationId(event.target.value)}><option value="">Todas unidades</option>{props.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      </div>
    </section>
    {(customerId || barberId || service || chartId || centerId || locationId) && <p className={styles.muted}>Filtros dimensionais excluem fatos sem dimensão correspondente.</p>}
    {report === "DASHBOARD" && <Dashboard accrual={byBasis.accrual} cash={byBasis.cash} forecast={byBasis.forecast} rows={filtered} unclassified={byBasis.unclassified} />}
    {report === "INCOME_STATEMENT" && <Statement title="DRE gerencial" groups={dre} total={sum(filtered.filter((row) => row.basis === "ACCRUAL"))} note="Competência. Pagamento de comissão não cria despesa novamente." />}
    {report === "CASH_FLOW" && <Statement title="Fluxo de caixa direto" groups={cashFlow} total={sum(filtered.filter((row) => row.basis === "CASH"))} note="Somente movimentos efetivos. Transferências internas não entram no consolidado." />}
    {report === "CUSTOMERS" && <Statement title="Valores recebidos por cliente" groups={customers} total={sum(filtered.filter((row) => row.basis === "CASH" && row.customer_id))} />}
    {report === "COMMISSIONS" && <Statement title="Comissões por profissional" groups={commissions} total={sum(filtered.filter((row) => row.source_type === "COMMISSION" || row.source_type === "COMMISSION_PAYOUT"))} />}
    {report === "FORECAST" && <Facts title="Previsão operacional da agenda" rows={filtered.filter((row) => row.basis === "FORECAST")} customers={props.customers} barbers={props.barbers} />}
    {report === "PAYABLES" && <Facts title="Contas a pagar" rows={filtered.filter((row) => row.source_type === "FINANCIAL_ENTRY" && row.signed_cents < 0)} customers={props.customers} barbers={props.barbers} />}
    {report === "RECEIVABLES" && <Facts title="Contas a receber" rows={filtered.filter((row) => (row.source_type === "FINANCIAL_ENTRY" || row.source_type === "APPOINTMENT_SERVICE") && row.signed_cents > 0)} customers={props.customers} barbers={props.barbers} />}
    {report === "BUDGET" && <Panel title="Orçamento" description="Versões aprovadas são imutáveis; comparação realizado x orçamento depende de linhas orçamentárias aprovadas.">{props.budgetVersions.length ? <div className={styles.list}>{props.budgetVersions.map((version) => <article key={version.id} className={styles.row}><strong>Versão {version.version_number}</strong><StatusChip active={version.status === "APPROVED"} label={version.status} /><small>{version.approved_at ? new Date(version.approved_at).toLocaleString("pt-BR") : "Rascunho"}</small></article>)}</div> : <EmptyState title="Sem orçamento">Crie orçamento anual no banco após migration local ser revisada e aplicada.</EmptyState>}</Panel>}
  </div>;
}

function group(rows: Props["facts"], key: (row: Props["facts"][number]) => string) { const map = new Map<string, number>(); rows.forEach((row) => map.set(key(row), (map.get(key(row)) ?? 0) + row.signed_cents)); return [...map.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])); }
function Statement({ title, groups, total, note }: { title: string; groups: Array<[string, number]>; total: number; note?: string }) { return <Panel title={title} description={note}>{groups.length ? <div className={styles.list}>{groups.map(([label, value]) => <article key={label} className={styles.row}><strong>{label}</strong><strong>{formatCents(value)}</strong></article>)}<article className={styles.row}><strong>Total</strong><strong>{formatCents(total)}</strong></article></div> : <EmptyState title="Sem dados">Ajuste filtros ou período.</EmptyState>}</Panel>; }
function Dashboard({ accrual, cash, forecast, rows, unclassified }: { accrual: number; cash: number; forecast: number; rows: Props["facts"]; unclassified: number }) { const expenses = sum(rows.filter((row) => row.basis === "ACCRUAL" && row.signed_cents < 0)); const revenue = sum(rows.filter((row) => row.basis === "ACCRUAL" && row.signed_cents > 0)); return <><section className={styles.stats}><article className={styles.stat}><span>Receita competência</span><strong>{formatCents(revenue)}</strong></article><article className={styles.stat}><span>Despesas competência</span><strong>{formatCents(expenses)}</strong></article><article className={styles.stat}><span>Resultado gerencial</span><strong>{formatCents(accrual)}</strong></article><article className={styles.stat}><span>Caixa realizado</span><strong>{formatCents(cash)}</strong></article><article className={styles.stat}><span>Cenário agenda</span><strong>{formatCents(forecast)}</strong><small>não garantido</small></article></section>{unclassified > 0 && <Panel title="Classificação pendente" description={`${unclassified} fato(s) com plano não classificado. Resultado total preservado; revise o plano de contas.`}><p className={styles.muted}>Classifique a conta antes de interpretar subtotais por grupo.</p></Panel>}</>; }
function Facts({ title, rows, customers, barbers }: { title: string; rows: Props["facts"]; customers: Props["customers"]; barbers: Props["barbers"] }) { return <Panel title={title} description="Detalhes derivados de fontes autoritativas.">{rows.length ? <div className={styles.list}>{rows.slice(0, 50).map((row) => <article key={`${row.source_type}-${row.source_id}-${row.service_id ?? ""}`} className={styles.row}><span className={styles.rowTitle}><strong>{row.service_name_snapshot ?? row.source_type}</strong><small>{customers.find((item) => item.id === row.customer_id)?.full_name ?? ""}{row.barber_id ? ` · ${barbers.find((item) => item.id === row.barber_id)?.display_name ?? ""}` : ""}</small></span><small>{row.fact_date}</small><StatusChip active={row.status !== "CANCELED"} label={row.status} /><strong>{formatCents(row.signed_cents)}</strong></article>)}</div> : <EmptyState title="Sem dados">Ajuste filtros ou período.</EmptyState>}</Panel>; }
