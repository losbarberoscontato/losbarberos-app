"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui";
import type { loadFinanceData } from "./server";
import type { AwaitedReturn } from "./utility-types";
import { centsFromInput, formatCents, formatRange } from "./format";
import { ActionMessage, EmptyState, Field, Panel, StatusChip } from "./shared";
import { assertResult, connectedClient, runMutation } from "./mutation-utils";
import { FinanceSubnav } from "./cash-manager";
import { BarberCashSessionReconciliation } from "./barber-cash-reconciliation";
import styles from "./connected-manager.module.css";

type Props = AwaitedReturn<typeof loadFinanceData>;

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  const spreadsheetSafe = /^[=+\-@]/u.test(text) ? `'${text}` : text;
  return `"${spreadsheetSafe.replaceAll('"', '""')}"`;
}

export function FinanceManager(props: Props) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [showPayout, setShowPayout] = useState(false);
  const [payPayout, setPayPayout] = useState<Props["payouts"][number] | null>(null);
  const [showManual, setShowManual] = useState(false);
  const customerById = useMemo(() => new Map(props.customers.map((item) => [item.id, item])), [props.customers]);
  const barberById = useMemo(() => new Map(props.barbers.map((item) => [item.id, item])), [props.barbers]);
  const financialById = useMemo(() => new Map(props.financial.map((item) => [item.appointment_id, item])), [props.financial]);
  const correctionsBySource = useMemo(() => {
    const totals = new Map<string, number>();
    for (const entry of props.ledger) {
      if (entry.source_entry_id) totals.set(entry.source_entry_id, (totals.get(entry.source_entry_id) ?? 0) + entry.amount_cents);
    }
    return totals;
  }, [props.ledger]);
  const captured = props.financial.reduce((sum, item) => sum + item.net_paid_cents, 0);
  const outstanding = props.financial.reduce((sum, item) => sum + item.outstanding_cents, 0);
  const commission = props.ledger.reduce((sum, item) => sum + item.amount_cents, 0);
  const openPayouts = props.payouts.filter((item) => item.status === "OPEN").reduce((sum, item) => sum + item.amount_cents, 0);
  const eligibleAppointments = props.appointments.filter((appointment) => {
    const financial = financialById.get(appointment.id);
    return (financial?.outstanding_cents ?? 0) > 0 || (financial?.net_paid_cents ?? 0) > 0;
  });

  async function createPayout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("create_commission_payout", {
        p_organization_id: props.organizationId,
        p_barber_id: String(data.get("barber_id")),
        p_period_start: String(data.get("period_start")),
        p_period_end: String(data.get("period_end")),
      }));
    }, "Lote de comissão criado com os lançamentos ainda não pagos.");
    if (saved) { setShowPayout(false); router.refresh(); }
  }

  async function markPaid(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!payPayout) return;
    const form = new FormData(event.currentTarget);
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("record_commission_payout", {
        p_payout_id: payPayout.id,
        p_financial_account_id: String(form.get("financial_account_id")),
        p_paid_on: String(form.get("paid_on")),
        p_payment_method: String(form.get("payment_method")),
        p_reference: String(form.get("reference") ?? "").trim() || null,
        p_idempotency_key: `manager:commission-payout:${payPayout.id}:${crypto.randomUUID()}`,
      }));
    }, "Pagamento de comissão registrado no Caixa.");
    if (saved) { setPayPayout(null); router.refresh(); }
  }

  async function recordManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const action = String(data.get("action"));
    const saved = await runMutation(setMessage, async () => {
      const rpc = action === "payment" ? "record_manual_payment" : "record_manual_refund";
      await assertResult(await connectedClient().rpc(rpc, {
        p_appointment_id: String(data.get("appointment_id")),
        p_amount_cents: centsFromInput(data.get("amount")),
        p_reference: String(data.get("reference") ?? "").trim(),
        p_idempotency_key: `manager:${action}:${crypto.randomUUID()}`,
      }));
    }, action === "payment" ? "Pagamento manual registrado no ledger." : "Reembolso manual registrado no ledger.");
    if (saved) { form.reset(); setShowManual(false); router.refresh(); }
  }

  async function correctCommission(entry: Props["ledger"][number], kind: "ADJUSTMENT" | "REVERSAL") {
    const remaining = entry.amount_cents + (correctionsBySource.get(entry.id) ?? 0);
    if (remaining <= 0) {
      setMessage("Esta comissão já foi totalmente revertida.");
      return;
    }
    let deltaCents = -remaining;
    if (kind === "ADJUSTMENT") {
      const raw = window.prompt("Ajuste em reais. Use valor positivo ou negativo (ex.: -10,00):");
      if (!raw) return;
      const numeric = Number(raw.trim().replace(/\./g, "").replace(",", "."));
      if (!Number.isFinite(numeric) || numeric === 0) {
        setMessage("Informe um ajuste diferente de zero.");
        return;
      }
      deltaCents = Math.round(numeric * 100);
    } else if (!window.confirm(`Reverter os ${formatCents(remaining)} ainda vigentes desta comissão?`)) {
      return;
    }
    const reason = window.prompt("Motivo obrigatório para a correção:");
    if (!reason?.trim()) return;
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("adjust_commission_entry", {
        p_source_entry_id: entry.id,
        p_kind: kind,
        p_delta_cents: deltaCents,
        p_reason: reason.trim(),
        p_idempotency_key: `manager:commission:${crypto.randomUUID()}`,
      }));
    }, kind === "REVERSAL" ? "Comissão revertida por evento compensatório." : "Comissão ajustada por evento compensatório.");
    if (saved) router.refresh();
  }

  function exportCsv() {
    const header = ["agendamento", "cliente", "status_agenda", "status_financeiro", "capturado_centavos", "reembolsado_centavos", "saldo_centavos"];
    const rows = props.appointments.map((appointment) => {
      const item = financialById.get(appointment.id);
      return [appointment.id, customerById.get(appointment.customer_id)?.full_name ?? "", appointment.status, item?.financial_status ?? "UNPAID", item?.captured_cents ?? 0, item?.refunded_cents ?? 0, item?.outstanding_cents ?? appointment.total_cents_snapshot];
    });
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `los-barberos-financeiro-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return <div className={styles.stack}>
    <PageHeader title="Financeiro e comissões" description="Saldo derivado do ledger; lançamentos passados nunca são editados." actions={<button className={`${styles.button} ${styles.buttonSoft}`} onClick={exportCsv} type="button">Exportar CSV real</button>} />
    <FinanceSubnav active="overview" />
    <ActionMessage message={message} />
    <section className={styles.stats}>
      <article className={styles.stat}><span>Capturado líquido</span><strong>{formatCents(captured)}</strong><small>todos os registros carregados</small></article>
      <article className={styles.stat}><span>Saldo a receber</span><strong>{formatCents(outstanding)}</strong><small>derivado por agendamento</small></article>
      <article className={styles.stat}><span>Comissão acumulada</span><strong>{formatCents(commission)}</strong><small>ganhos, reversões e ajustes</small></article>
      <article className={styles.stat}><span>Lotes abertos</span><strong>{formatCents(openPayouts)}</strong><small>repasse manual</small></article>
    </section>
    <Panel title="Conciliação" description="Feche primeiro os caixas diários dos Barbeiros. Reembolsos e mensagens permanecem auditáveis.">
      <section className={styles.list} aria-label="Caixas diários dos Barbeiros"><h3>Caixas diários dos Barbeiros</h3><BarberCashSessionReconciliation sessions={props.barberCashSessions} barberNames={props.barberNames} setMessage={setMessage} onSaved={() => router.refresh()} /></section>
      {props.refundJobs.length > 0 || props.outboxIssues.length > 0 ? <div className={styles.grid}>
        <section className={styles.span6}><h3>Reembolsos</h3><div className={styles.list}>{props.refundJobs.map((job) => <article className={styles.card} key={job.id}><div className={styles.cardTop}><strong>{formatCents(job.amount_cents)}</strong><span className={`${styles.chip} ${job.status === "SEND_UNKNOWN" ? styles.chipDanger : styles.chipWarn}`}>{job.status}</span></div><small className={styles.muted}>Tentativas: {job.attempts} · agendamento {job.appointment_id.slice(0, 8)}</small>{job.last_error && <small>{job.last_error}</small>}<p className={styles.muted}>{job.status === "SEND_UNKNOWN" ? "Confirme no Mercado Pago antes de qualquer nova ação. Não reenvie às cegas." : "O worker seguirá retry quando aplicável; acompanhe o próximo processamento."}</p></article>)}</div></section>
        <section className={styles.span6}><h3>WhatsApp</h3><div className={styles.list}>{props.outboxIssues.map((item) => <article className={styles.card} key={item.id}><div className={styles.cardTop}><strong>{item.template_key}</strong><span className={`${styles.chip} ${item.status === "SEND_UNKNOWN" ? styles.chipDanger : styles.chipWarn}`}>{item.status}</span></div><small className={styles.muted}>{item.recipient_e164} · tentativas {item.attempts}</small>{item.last_error && <small>{item.last_error}</small>}<p className={styles.muted}>{item.status === "SEND_UNKNOWN" ? "Entrega pode ter ocorrido. Confira no provedor e não dispare duplicado." : "Falha registrada; retry permanece responsabilidade do worker."}</p></article>)}</div></section>
      </div> : <p className={styles.muted}>Sem reembolsos ou mensagens em estado de conciliação.</p>}
    </Panel>
    <Panel title="Saldos por agendamento" description="Pagamento e reembolso manual geram eventos compensatórios" action={<button className={styles.button} type="button" disabled={!eligibleAppointments.length} onClick={() => setShowManual((value) => !value)}>Registrar evento manual</button>}>
      {showManual && <form className={styles.form} onSubmit={recordManual}><Field label="Ação"><select name="action"><option value="payment">Pagamento recebido</option><option value="refund">Reembolso realizado</option></select></Field><Field label="Agendamento"><select name="appointment_id">{eligibleAppointments.map((appointment) => <option key={appointment.id} value={appointment.id}>{customerById.get(appointment.customer_id)?.full_name} · {formatRange(appointment.service_period)}</option>)}</select></Field><Field label="Valor (R$)"><input name="amount" required inputMode="decimal" /></Field><Field label="Referência"><input name="reference" required placeholder="PIX, comprovante ou protocolo" /></Field><div className={`${styles.toolbarGroup} ${styles.formWide}`}><button className={styles.button}>Registrar no ledger</button><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => setShowManual(false)}>Cancelar</button></div></form>}
      {props.appointments.length === 0 ? <EmptyState title="Sem movimentação">O financeiro aparecerá após o primeiro agendamento real.</EmptyState> : <div className={styles.list}>{props.appointments.slice(0, 100).map((appointment) => { const item = financialById.get(appointment.id); return <article className={styles.row} key={appointment.id}><span className={styles.rowTitle}><strong>{customerById.get(appointment.customer_id)?.full_name ?? "Cliente"}</strong><small>{formatRange(appointment.service_period)}</small></span><span>Pago {formatCents(item?.net_paid_cents)}</span><span>Saldo {formatCents(item?.outstanding_cents ?? appointment.total_cents_snapshot)}</span><StatusChip active={item?.financial_status === "PAID"} label={item?.financial_status ?? "UNPAID"} /><span /></article>; })}</div>}
    </Panel>
    <div className={styles.grid}>
      <Panel title="Ledger de comissão" description="Append-only" className={styles.span7}>
        {props.ledger.length === 0 ? <EmptyState title="Sem comissão">A comissão nasce somente ao concluir um atendimento.</EmptyState> : <div className={styles.list}>{props.ledger.map((entry) => { const remaining = entry.kind === "EARNED" ? entry.amount_cents + (correctionsBySource.get(entry.id) ?? 0) : null; return <article className={styles.row} key={entry.id}><span className={styles.rowTitle}><strong>{barberById.get(entry.barber_id)?.display_name ?? "Profissional"}</strong><small>{new Date(entry.earned_at).toLocaleString("pt-BR")} · {entry.reason ?? entry.kind}{remaining !== null ? ` · vigente ${formatCents(remaining)}` : ""}</small></span><strong>{formatCents(entry.amount_cents)}</strong><StatusChip active={entry.kind === "EARNED"} label={entry.kind} /><span /><span className={styles.rowActions}>{entry.kind === "EARNED" && remaining !== null && remaining > 0 && <><button className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} type="button" onClick={() => correctCommission(entry, "ADJUSTMENT")}>Ajustar</button><button className={`${styles.button} ${styles.buttonDanger} ${styles.buttonSmall}`} type="button" onClick={() => correctCommission(entry, "REVERSAL")}>Reverter</button></>}</span></article>; })}</div>}
      </Panel>
      <Panel title="Lotes de pagamento" description="Pagamento gera saída de caixa; não duplica despesa na DRE." className={styles.span5} action={<button className={styles.button} type="button" disabled={!props.barbers.length} onClick={() => setShowPayout((value) => !value)}>Criar lote</button>}>
        {showPayout && <form className={styles.form} onSubmit={createPayout}><Field label="Profissional"><select name="barber_id">{props.barbers.map((barber) => <option key={barber.id} value={barber.id}>{barber.display_name}</option>)}</select></Field><Field label="Início"><input type="date" name="period_start" required /></Field><Field label="Fim"><input type="date" name="period_end" required /></Field><button className={styles.button}>Fechar período</button></form>}
        {payPayout && <form className={styles.form} onSubmit={markPaid}><p className={styles.formWide}>Liquidação integral: <strong>{formatCents(payPayout.amount_cents)}</strong></p><Field label="Banco ou caixa"><select name="financial_account_id" required><option value="">Selecione</option>{props.financialAccounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></Field><Field label="Data"><input name="paid_on" type="date" required defaultValue={new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date())} /></Field><Field label="Método"><select name="payment_method"><option value="PIX">PIX</option><option value="TRANSFER">Transferência</option><option value="CASH">Dinheiro</option><option value="OTHER">Outro</option></select></Field><Field label="Referência"><input name="reference" placeholder="Comprovante ou protocolo" /></Field><div className={`${styles.toolbarGroup} ${styles.formWide}`}><button className={styles.button}>Confirmar pagamento</button><button type="button" className={`${styles.button} ${styles.buttonSoft}`} onClick={() => setPayPayout(null)}>Cancelar</button></div></form>}
        {props.payouts.length === 0 ? <EmptyState title="Sem lotes">Crie um lote após existir comissão positiva não paga.</EmptyState> : <div className={styles.list}>{props.payouts.map((payout) => <article className={styles.card} key={payout.id}><div className={styles.cardTop}><span className={styles.rowTitle}><strong>{barberById.get(payout.barber_id)?.display_name}</strong><small>{payout.period_start} a {payout.period_end}</small></span><StatusChip active={payout.status === "PAID"} label={payout.status} /></div><strong>{formatCents(payout.amount_cents)}</strong>{payout.status === "OPEN" && <button className={`${styles.button} ${styles.buttonSmall}`} onClick={() => setPayPayout(payout)} type="button">Pagar no Caixa</button>}</article>)}</div>}
      </Panel>
    </div>
  </div>;
}
