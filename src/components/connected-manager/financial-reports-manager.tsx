"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Printer } from "lucide-react";
import type { loadFinancialReportsData } from "./server";
import type { AwaitedReturn } from "./utility-types";
import type { BarberCashClosureReportRecord, FinancialReportType } from "./types";
import { formatCents } from "./format";
import { Dialog, FinanceSubnav } from "./cash-manager";
import { EmptyState, Field, Panel, StatusChip } from "./shared";
import { assertResult, connectedClient, runMutation } from "./mutation-utils";
import { PageHeader } from "@/components/ui";
import styles from "./connected-manager.module.css";

type Props = AwaitedReturn<typeof loadFinancialReportsData>;

const reportTabs: Array<{ id: FinancialReportType; label: string }> = [
  { id: "CASH_FLOW", label: "Fluxo de caixa (DFC)" }, { id: "BUDGET", label: "Orçamento" }, { id: "CLOSURES", label: "Fechamentos" }, { id: "PROJECTS", label: "Projetos" },
];

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${(/^[=+\-@]/u.test(text) ? `'${text}` : text).replaceAll('"', '""')}"`;
}

function sum(rows: Props["facts"]) { return rows.reduce((total, row) => total + row.signed_cents, 0); }

function createInternalDocumentNumber() {
  const random = crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
  return `COM-${random}`;
}

function GeneralFinancialReportsManager(props: Props & { initialReport?: FinancialReportType }) {
  const [report, setReport] = useState<FinancialReportType>(props.initialReport === "BUDGET" ? "BUDGET" : "CASH_FLOW");
  const [start, setStart] = useState(props.from);
  const [end, setEnd] = useState(props.to);
  const [chartId, setChartId] = useState("");
  const [centerId, setCenterId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [tagSearch, setTagSearch] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const tagFilterRef = useRef<HTMLDivElement>(null);

  const reportTags = useMemo(() => [...(props.tags ?? [])].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")), [props.tags]);
  const visibleTags = useMemo(() => reportTags.filter((tag) => tag.name.toLocaleLowerCase("pt-BR").includes(tagSearch.toLocaleLowerCase("pt-BR"))), [reportTags, tagSearch]);
  const selectedTagNames = useMemo(() => selectedTagIds.map((id) => reportTags.find((tag) => tag.id === id)?.name).filter((name): name is string => Boolean(name)), [reportTags, selectedTagIds]);
  const availableReportTabs = useMemo(() => props.projectsModuleEnabled ? reportTabs : reportTabs.filter((tab) => tab.id !== "PROJECTS"), [props.projectsModuleEnabled]);

  useEffect(() => {
    function closeTagMenu(event: PointerEvent) {
      if (!tagFilterRef.current?.contains(event.target as Node)) setTagMenuOpen(false);
    }
    document.addEventListener("pointerdown", closeTagMenu);
    return () => document.removeEventListener("pointerdown", closeTagMenu);
  }, []);

  const filtered = useMemo(() => props.facts.filter((row) =>
    (!start || row.fact_date >= start) && (!end || row.fact_date <= end) &&
    (!chartId || row.chart_account_id === chartId) && (!centerId || row.cost_center_id === centerId) && (!locationId || row.location_id === locationId) &&
    (!selectedTagNames.length || selectedTagNames.every((selectedTag) => row.tag_names?.some((tag) => tag.toLocaleLowerCase("pt-BR") === selectedTag.toLocaleLowerCase("pt-BR")))),
  ), [props.facts, start, end, chartId, centerId, locationId, selectedTagNames]);

  const cashFlow = useMemo(() => group(filtered.filter((row) => row.basis === "CASH"), (row) => row.cash_flow_activity ?? "Não classificado"), [filtered]);

  function exportCsv() {
    const header = ["base", "origem", "data", "competencia", "vencimento", "cliente", "profissional", "servico", "valor_centavos", "status"];
    const rows = filtered.map((row) => [row.basis, row.source_type, row.fact_date, row.competence_date, row.due_date, props.customers.find((item) => item.id === row.customer_id)?.full_name ?? "", props.barbers.find((item) => item.id === row.barber_id)?.display_name ?? "", row.service_name_snapshot ?? "", row.signed_cents, row.status]);
    const url = URL.createObjectURL(new Blob([[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `los-barberos-${report.toLowerCase()}-${start}-${end}.csv`; anchor.click(); URL.revokeObjectURL(url);
  }

  return <div className={`${styles.stack} ${styles.reportsLayout}`}>
    <PageHeader title="Relatórios financeiros" description="Visão gerencial por competência e caixa. Não substitui escrituração contábil oficial." actions={<div className={styles.toolbarGroup}><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => window.print()}><Printer size={16} /> Imprimir/PDF</button><button className={styles.button} type="button" onClick={exportCsv}><Download size={16} /> CSV</button></div>} />
    <FinanceSubnav active={props.initialReport === "COMMISSIONS" ? "commissions" : "reports"} />
    {props.initialReport !== "COMMISSIONS" && <nav className={styles.tabs} aria-label="Relatórios financeiros">{availableReportTabs.map((tab) => <button key={tab.id} type="button" className={`${styles.tab} ${report === tab.id ? styles.tabActive : ""}`} onClick={() => setReport(tab.id)}>{tab.label}</button>)}</nav>}
    {report !== "CLOSURES" && report !== "PROJECTS" && <section className={`${styles.toolbar} ${styles.reportsFilters}`}>
      <div className={styles.toolbarGroup}>
        <input className={styles.packageFilterSelect} type="date" aria-label="Data inicial" value={start} onChange={(event) => setStart(event.target.value)} />
        <input className={styles.packageFilterSelect} type="date" aria-label="Data final" value={end} onChange={(event) => setEnd(event.target.value)} />
        <select className={styles.packageFilterSelect} aria-label="Plano de conta" value={chartId} onChange={(event) => setChartId(event.target.value)}><option value="">Todos planos</option>{props.chartAccounts.map((item) => <option key={item.id} value={item.id}>{item.code ? `${item.code} · ` : ""}{item.name}</option>)}</select>
        <select className={styles.packageFilterSelect} aria-label="Centro de custo" value={centerId} onChange={(event) => setCenterId(event.target.value)}><option value="">Todos centros</option>{props.costCenters.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select className={styles.packageFilterSelect} aria-label="Unidade" value={locationId} onChange={(event) => setLocationId(event.target.value)}><option value="">Todas unidades</option>{props.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <div className={styles.tagFilter} ref={tagFilterRef}>
          <input className={styles.packageFilterSelect} type="search" role="combobox" aria-label="Pesquisar por tag" placeholder={selectedTagIds.length ? `${selectedTagIds.length} tag(s) selecionada(s)` : "Pesquisar por tag"} value={tagSearch} onFocus={() => setTagMenuOpen(true)} onChange={(event) => { setTagSearch(event.target.value); setTagMenuOpen(true); }} aria-expanded={tagMenuOpen} aria-controls="financial-report-tags" aria-autocomplete="list" />
          {tagMenuOpen && <div className={styles.tagFilterMenu} id="financial-report-tags" role="listbox" aria-label="Tags disponíveis">
            <div className={styles.tagFilterSummary}>{selectedTagIds.length ? `${selectedTagIds.length} tag(s) selecionada(s)` : "Selecione uma ou mais tags"}</div>
            {visibleTags.length ? visibleTags.map((tag) => <label className={styles.tagFilterOption} key={tag.id}><input type="checkbox" checked={selectedTagIds.includes(tag.id)} onChange={(event) => setSelectedTagIds((current) => event.target.checked ? [...current, tag.id] : current.filter((id) => id !== tag.id))} /> <span>{tag.name}</span></label>) : <p className={styles.tagFilterEmpty}>Nenhuma tag encontrada.</p>}
            {selectedTagIds.length > 0 && <button className={styles.tagFilterClear} type="button" onClick={() => setSelectedTagIds([])}>Limpar tags</button>}
          </div>}
        </div>
      </div>
    </section>}
    {report === "CLOSURES" && <ClosureReport closures={props.barberCashClosures ?? []} barbers={props.barbers} />}
    {report === "PROJECTS" && <Panel title="Projetos" description="Relatório do módulo Projetos."><EmptyState title="Em breve">Em breve.</EmptyState></Panel>}
    {report !== "CLOSURES" && report !== "PROJECTS" && (chartId || centerId || locationId || selectedTagIds.length > 0) && <p className={styles.muted}>Filtros aplicados sobre os fatos financeiros carregados.</p>}
    {report === "CASH_FLOW" && <Statement title="Fluxo de caixa direto" groups={cashFlow} total={sum(filtered.filter((row) => row.basis === "CASH"))} note="Somente movimentos efetivos. Transferências internas não entram no consolidado." />}
    {report === "BUDGET" && <Panel title="Orçamento" description="Versões aprovadas são imutáveis; comparação realizado x orçamento depende de linhas orçamentárias aprovadas.">{props.budgetVersions.length ? <div className={styles.list}>{props.budgetVersions.map((version) => <article key={version.id} className={styles.row}><strong>Versão {version.version_number}</strong><StatusChip active={version.status === "APPROVED"} label={version.status} /><small>{version.approved_at ? new Date(version.approved_at).toLocaleString("pt-BR") : "Rascunho"}</small></article>)}</div> : <EmptyState title="Sem orçamento">Crie orçamento anual no banco após migration local ser revisada e aplicada.</EmptyState>}</Panel>}
  </div>;
}

function ClosureReport({ closures, barbers }: { closures: BarberCashClosureReportRecord[]; barbers: Props["barbers"] }) {
  const [barberId, setBarberId] = useState("");
  const filtered = useMemo(() => [...closures]
    .filter((closure) => !barberId || closure.barber_id === barberId)
    .sort((a, b) => b.id - a.id), [closures, barberId]);

  function formatDate(value: string) {
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
  }

  return <div className={styles.stack}>
    <section className={styles.toolbar}>
      <div className={styles.toolbarGroup}>
        <select className={styles.packageFilterSelect} aria-label="Profissional do fechamento" value={barberId} onChange={(event) => setBarberId(event.target.value)}>
          <option value="">Todos profissionais</option>
          {barbers.map((barber) => <option key={barber.id} value={barber.id}>{barber.display_name}</option>)}
        </select>
      </div>
    </section>
    <Panel title="Fechamentos" description="Histórico dos fechamentos realizados pelo gestor. Clique em uma linha para ver os lançamentos do caixa.">
      {filtered.length ? <div className={styles.closureReportTable} role="table" aria-label="Fechamentos realizados">
        <div className={`${styles.closureReportHeader} ${styles.closureReportGrid}`} role="row"><strong>ID do fechamento</strong><strong>Data do fechamento</strong><strong>Profissional · usuário administrativo</strong><strong>Valor do fechamento</strong></div>
        {filtered.map((closure) => <details className={styles.closureReportRow} key={closure.id}>
          <summary className={`${styles.closureReportSummary} ${styles.closureReportGrid}`}>
            <strong>#{closure.id}</strong>
            <span>{formatDate(closure.reconciled_at)}</span>
            <span><strong>{closure.barber_name}</strong><small>{closure.reconciled_by_name}</small></span>
            <strong>{formatCents(closure.reconciled_cents)}</strong>
          </summary>
          <div className={styles.closureReportDetails}>
            <strong>Lançamentos deste fechamento</strong>
            {closure.launches.length ? <div className={styles.closureLaunchTable} role="table" aria-label={`Lançamentos do fechamento ${closure.id}`}>
              <div className={`${styles.closureLaunchHeader} ${styles.closureLaunchGrid}`} role="row"><strong>Cliente</strong><strong>Data</strong><strong>Valor</strong><strong>Conta financeira</strong></div>
              {closure.launches.map((launch) => <div className={`${styles.closureLaunchRow} ${styles.closureLaunchGrid}`} role="row" key={launch.id}><span><strong>{launch.customer_name}</strong><small>{launch.payment_method}</small></span><span>{formatDate(launch.transaction_date)}</span><strong>{formatCents(launch.amount_cents)}</strong><span>{launch.financial_account_name}</span></div>)}
            </div> : <p className={styles.muted}>Nenhum lançamento vinculado.</p>}
          </div>
        </details>)}
      </div> : <EmptyState title="Sem fechamentos">Nenhum fechamento encontrado para o profissional selecionado.</EmptyState>}
    </Panel>
  </div>;
}

function group(rows: Props["facts"], key: (row: Props["facts"][number]) => string) { const map = new Map<string, number>(); rows.forEach((row) => map.set(key(row), (map.get(key(row)) ?? 0) + row.signed_cents)); return [...map.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])); }
function Statement({ title, groups, total, note }: { title: string; groups: Array<[string, number]>; total: number; note?: string }) { return <Panel title={title} description={note}>{groups.length ? <div className={styles.list}>{groups.map(([label, value]) => <article key={label} className={styles.row}><strong>{label}</strong><strong>{formatCents(value)}</strong></article>)}<article className={styles.row}><strong>Total</strong><strong>{formatCents(total)}</strong></article></div> : <EmptyState title="Sem dados">Ajuste filtros ou período.</EmptyState>}</Panel>; }
type CommissionProps = Props & { initialReport?: FinancialReportType };

function CommissionReport({ props }: { props: CommissionProps }) {
  const router = useRouter();
  const [start, setStart] = useState(props.from);
  const [end, setEnd] = useState(props.to);
  const [barberId, setBarberId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [selectedBarberId, setSelectedBarberId] = useState<string | null>(null);
  const [selectedCommissionIds, setSelectedCommissionIds] = useState<string[]>([]);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentDocumentNumber, setPaymentDocumentNumber] = useState("");
  const [message, setMessage] = useState("");

  const filteredDetails = useMemo(() => props.commissionDetails.filter((detail) =>
    (!start || detail.service_date >= start) && (!end || detail.service_date <= end) &&
    (!barberId || detail.barber_id === barberId) && (!locationId || detail.location_id === locationId),
  ), [props.commissionDetails, start, end, barberId, locationId]);

  const rows = useMemo(() => {
    const grouped = new Map<string, { barberId: string; name: string; payable: number; paid: number }>();
    filteredDetails.forEach((detail) => {
      const barber = props.barbers.find((item) => item.id === detail.barber_id);
      const row = grouped.get(detail.barber_id) ?? { barberId: detail.barber_id, name: barber?.display_name ?? "Profissional", payable: 0, paid: 0 };
      row.payable += Math.max(detail.payable_commission_cents, 0);
      row.paid += Math.max(detail.paid_commission_cents, 0);
      grouped.set(detail.barber_id, row);
    });
    return [...grouped.values()].map((row) => ({ ...row, total: row.payable + row.paid })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [filteredDetails, props.barbers]);

  const selectedBarber = rows.find((row) => row.barberId === selectedBarberId) ?? null;
  const selectedDetails = useMemo(() => filteredDetails.filter((detail) => detail.barber_id === selectedBarberId), [filteredDetails, selectedBarberId]);
  const selectedPayable = selectedBarber?.payable ?? 0;
  const selectedTotal = useMemo(() => selectedDetails.reduce((total, detail) => selectedCommissionIds.includes(detail.appointment_item_id) ? total + Math.max(detail.payable_commission_cents, 0) : total, 0), [selectedDetails, selectedCommissionIds]);
  const activeAccounts = props.accounts.filter((account) => account.active);
  const selectedReceivedOn = useMemo(() => selectedDetails
    .filter((detail) => selectedCommissionIds.includes(detail.appointment_item_id))
    .map((detail) => detail.received_on)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()), [selectedDetails, selectedCommissionIds]);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

  function resetCommissionSelection() {
    setSelectedCommissionIds([]);
    setPaymentOpen(false);
  }

  function formatServiceDate(value: string) {
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(`${value}T12:00:00`));
  }

  async function payCommission(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedBarber || selectedTotal <= 0 || !selectedCommissionIds.length) return;
    const data = new FormData(event.currentTarget);
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("pay_commission", {
        p_organization_id: props.organizationId,
        p_barber_id: selectedBarber.barberId,
        p_period_start: start,
        p_period_end: end,
        p_appointment_item_ids: selectedCommissionIds,
        p_financial_account_id: String(data.get("financial_account_id") ?? ""),
        p_launch_on: String(data.get("launch_on") ?? selectedReceivedOn),
        p_due_on: String(data.get("due_on") ?? today),
        p_payment_method: String(data.get("payment_method") ?? "TRANSFER"),
        p_document_number: paymentDocumentNumber,
        p_tags: String(data.get("tags") ?? "").trim() || null,
        p_reference: paymentDocumentNumber,
        p_idempotency_key: `manager:commission-payment:${selectedBarber.barberId}:${start}:${end}:${crypto.randomUUID()}`,
      }));
    }, "Comissão paga e lançada no Caixa.");
    if (saved) {
      setPaymentOpen(false);
      setSelectedCommissionIds([]);
      setSelectedBarberId(null);
      router.refresh();
    }
  }

  return <div className={styles.stack}>
    <PageHeader title="Comissões" description="Comissões entram após a conclusão do atendimento, conforme a regra da origem." />
    <FinanceSubnav active="commissions" />
    <section className={styles.toolbar}>
      <div className={styles.toolbarGroup}>
        <input className={styles.packageFilterSelect} type="date" aria-label="Data inicial" value={start} onChange={(event) => { resetCommissionSelection(); setStart(event.target.value); }} />
        <input className={styles.packageFilterSelect} type="date" aria-label="Data final" value={end} onChange={(event) => { resetCommissionSelection(); setEnd(event.target.value); }} />
        <select className={styles.packageFilterSelect} aria-label="Profissional" value={barberId} onChange={(event) => { resetCommissionSelection(); setBarberId(event.target.value); }}><option value="">Todos profissionais</option>{props.barbers.filter((barber) => barber.active).map((barber) => <option key={barber.id} value={barber.id}>{barber.display_name}</option>)}</select>
        <select className={styles.packageFilterSelect} aria-label="Unidade" value={locationId} onChange={(event) => { resetCommissionSelection(); setLocationId(event.target.value); }}><option value="">Todas unidades</option>{props.locations.filter((location) => location.active).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select>
      </div>
    </section>
    {message && <p className={styles.message} role="status">{message}</p>}
    <Panel title="Comissões por profissional" description="Clique no profissional para ver serviços e pagar o saldo em aberto.">
      {rows.length ? <div className={styles.commissionTable} role="table" aria-label="Comissões por profissional">
        <div className={`${styles.commissionRow} ${styles.commissionHeader}`} role="row"><strong>Profissional</strong><strong>À Pagar</strong><strong>Pago</strong><strong>Total</strong></div>
        {rows.map((row) => <button key={row.barberId} type="button" className={styles.commissionRow} role="row" onClick={() => { resetCommissionSelection(); setSelectedBarberId(row.barberId); }}><strong>{row.name}</strong><strong>{formatCents(row.payable)}</strong><strong>{formatCents(row.paid)}</strong><strong>{formatCents(row.total)}</strong></button>)}
        <div className={`${styles.commissionRow} ${styles.commissionTotal}`} role="row"><strong>Total</strong><strong>{formatCents(rows.reduce((sum, row) => sum + row.payable, 0))}</strong><strong>{formatCents(rows.reduce((sum, row) => sum + row.paid, 0))}</strong><strong>{formatCents(rows.reduce((sum, row) => sum + row.total, 0))}</strong></div>
      </div> : <EmptyState title="Sem comissões no período">Ajuste o período, profissional ou unidade.</EmptyState>}
    </Panel>
    {selectedBarber && <Dialog title={`Comissões · ${selectedBarber.name}`} wide modalClassName={styles.commissionDialog} onClose={() => setSelectedBarberId(null)}>
      <div className={styles.commissionModalBody}>
        <div className={styles.commissionTable} role="table" aria-label={`Serviços de ${selectedBarber.name}`}>
          <div className={`${styles.commissionServiceRow} ${styles.commissionHeader}`} role="row"><strong>Cliente</strong><strong>Serviço</strong><strong>Data</strong><strong>Valor</strong><strong>Comissão</strong></div>
          {selectedDetails.map((detail) => {
            const isPaid = detail.payable_commission_cents <= 0 && detail.paid_commission_cents > 0;
            const isSelected = selectedCommissionIds.includes(detail.appointment_item_id);
            return <div className={styles.commissionServiceRow} role="row" key={detail.appointment_item_id}><span>{detail.customer_name}</span><span>{detail.service_name}{detail.is_project && <small>Projeto</small>}</span><span>{formatServiceDate(detail.service_date)}</span><span><strong>{formatCents(detail.service_value_paid_cents)}</strong><small>{detail.financial_account_names ?? "Conta não vinculada"}</small></span><span className={styles.commissionSelectionCell}><input type="checkbox" aria-label={`Selecionar comissão de ${detail.service_name}`} checked={isSelected} disabled={isPaid || detail.payable_commission_cents <= 0} onChange={(event) => setSelectedCommissionIds((current) => event.target.checked ? [...current, detail.appointment_item_id] : current.filter((id) => id !== detail.appointment_item_id))} /><span><strong>{formatCents(detail.payable_commission_cents || detail.paid_commission_cents)}</strong><small>{isPaid ? "Pago" : "Em aberto"}</small></span></span></div>;
          })}
        </div>
        <div className={styles.commissionModalFooter}><div className={styles.commissionSummary}><strong>À pagar: {formatCents(selectedPayable)}</strong><strong>Total selecionado: {formatCents(selectedTotal)}</strong></div><button className={styles.button} type="button" disabled={selectedTotal <= 0 || !activeAccounts.length} onClick={() => { setPaymentDocumentNumber(createInternalDocumentNumber()); setPaymentOpen(true); }}>Pagar Comissão</button></div>
        {!activeAccounts.length && <p className={styles.muted}>Cadastre uma conta financeira ativa antes de pagar.</p>}
      </div>
    </Dialog>}
    {paymentOpen && selectedBarber && <Dialog title="Pagar Comissão" onClose={() => setPaymentOpen(false)}>
      <form className={styles.form} onSubmit={payCommission}>
        <Field label="Tipo de conta"><input value="Única" readOnly /></Field>
        <Field label="Descrição"><input value={`Pagamento de comissão · ${selectedBarber.name}`} readOnly /></Field>
        <Field label="Valor (R$)"><input value={formatCents(selectedTotal)} readOnly aria-readonly="true" /></Field>
        <Field label="Data do lançamento"><input name="launch_on" type="date" value={selectedReceivedOn} readOnly required /></Field>
        <Field label="Vencimento"><input name="due_on" type="date" defaultValue={today} required /></Field>
        <Field label="Plano de conta"><input value="Custo de serviços · Comissão" readOnly /></Field>
        <Field label="Banco ou caixa"><select name="financial_account_id" required defaultValue=""><option value="" disabled>Selecione</option>{activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></Field>
        <Field label="Centro de custo"><input value="Não informar" readOnly /></Field>
        <Field label="Número do documento"><input name="document_number" value={paymentDocumentNumber} readOnly aria-readonly="true" /></Field>
        <Field label="Profissional"><input value={selectedBarber.name} readOnly /></Field>
        <Field label="Forma de pagamento"><select name="payment_method" defaultValue="TRANSFER"><option value="PIX">PIX</option><option value="CARD">Cartão</option><option value="CASH">Dinheiro</option><option value="BOLETO">Boleto</option><option value="TRANSFER">Transferência</option><option value="OTHER">Outra</option></select></Field>
        <Field label="Tags" wide><textarea name="tags" defaultValue="Pagamento de comissão" /></Field>
        <p className={styles.muted}>Pagamento reduz “À Pagar”, soma “Pago” e registra saída na conta selecionada.</p>
        <div className={styles.toolbarGroup}><button className={styles.button} type="submit">Adicionar</button><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => setPaymentOpen(false)}>Cancelar</button></div>
      </form>
    </Dialog>}
  </div>;
}

export function FinancialReportsManager(props: CommissionProps) {
  return props.initialReport === "COMMISSIONS" ? <CommissionReport props={props} /> : <GeneralFinancialReportsManager {...props} />;
}
