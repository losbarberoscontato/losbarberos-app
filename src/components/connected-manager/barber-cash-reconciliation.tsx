"use client";

import { useMemo, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { centsFromInput, formatCents } from "./format";
import { assertResult, connectedClient, runMutation } from "./mutation-utils";
import { EmptyState, Field, StatusChip } from "./shared";
import type { BarberCashReceiptRecord, FinancialAccountRecord } from "./types";
import styles from "./connected-manager.module.css";

export type BarberCashSession = {
  id: string;
  barber_id: string;
  business_date: string;
  status: "OPEN" | "RECONCILED";
  expected_cents: number;
  reconciled_cents: number | null;
  variance_cents: number | null;
  variance_reason: string | null;
};

type AccountBreakdown = {
  financial_account_id: string;
  expected_cents: number;
  reconciled_cents: number;
};

function formatBusinessDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(`${value}T12:00:00`));
}

function parseBreakdownValue(values: Record<string, string>, accountId: string) {
  try {
    return Math.max(0, centsFromInput(values[accountId] ?? "0"));
  } catch {
    return 0;
  }
}

export function BarberCashSessionReconciliation({ sessions, receipts = [], financialAccounts = [], barberNames, demoMode, setMessage, onSaved }: { sessions: BarberCashSession[]; receipts?: BarberCashReceiptRecord[]; financialAccounts?: FinancialAccountRecord[]; barberNames: Record<string, string>; demoMode?: boolean; setMessage: (value: string) => void; onSaved: () => void }) {
  const [selected, setSelected] = useState<BarberCashSession | null>(null);
  const [reconciledByAccount, setReconciledByAccount] = useState<Record<string, string>>({});

  const accountById = useMemo(() => new Map(financialAccounts.map((account) => [account.id, account])), [financialAccounts]);
  const selectedRows = useMemo(() => {
    if (!selected) return [];
    const totals = new Map<string, number>();
    receipts.filter((receipt) => receipt.cash_session_id === selected.id && receipt.status === "PENDING_RECONCILIATION").forEach((receipt) => totals.set(receipt.financial_account_id, (totals.get(receipt.financial_account_id) ?? 0) + receipt.amount_cents));
    return [...totals.entries()].map(([financial_account_id, expected_cents]) => ({ financial_account_id, expected_cents }));
  }, [receipts, selected]);
  const totalReconciled = selectedRows.reduce((sum, row) => sum + parseBreakdownValue(reconciledByAccount, row.financial_account_id), 0);
  const totalExpected = selected?.expected_cents ?? 0;
  const difference = totalReconciled - totalExpected;

  function openSession(session: BarberCashSession) {
    const grouped = new Map<string, number>();
    receipts.filter((receipt) => receipt.cash_session_id === session.id && receipt.status === "PENDING_RECONCILIATION").forEach((receipt) => grouped.set(receipt.financial_account_id, (grouped.get(receipt.financial_account_id) ?? 0) + receipt.amount_cents));
    setReconciledByAccount(Object.fromEntries([...grouped.entries()].map(([accountId, amount]) => [accountId, (amount / 100).toFixed(2).replace(".", ",")])));
    setSelected(session);
  }

  function closeSession() {
    setSelected(null);
    setReconciledByAccount({});
  }

  async function reconcile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    if (demoMode) { setMessage("Modo demonstração: conciliação não altera dados."); return; }
    const data = new FormData(event.currentTarget);
    const reason = String(data.get("reason") ?? "").trim();
    try {
      selectedRows.forEach((row) => { centsFromInput(reconciledByAccount[row.financial_account_id] ?? "0"); });
    } catch {
      setMessage("Informe valores apurados válidos para todas as contas.");
      return;
    }
    if (difference !== 0 && !reason) {
      setMessage("Informe o motivo obrigatório para fechar um caixa com diferença.");
      return;
    }
    const accountBreakdown: AccountBreakdown[] = selectedRows.map((row) => ({
      financial_account_id: row.financial_account_id,
      expected_cents: row.expected_cents,
      reconciled_cents: parseBreakdownValue(reconciledByAccount, row.financial_account_id),
    }));
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("reconcile_barber_cash_session", {
        p_session_id: selected.id,
        p_reconciled_cents: totalReconciled,
        p_variance_reason: reason || null,
        p_account_breakdown: accountBreakdown,
        p_idempotency_key: `manager:barber-cash-reconcile:${selected.id}:${crypto.randomUUID()}`,
      }));
    }, "Caixa do Barbeiro conciliado e confirmado nas contas selecionadas.");
    if (saved) { closeSession(); onSaved(); }
  }

  return <>
    {!sessions.length ? <EmptyState title="Nenhum caixa diário aberto">Os caixas surgem quando um Barbeiro com permissão recebe um atendimento.</EmptyState> : <div className={styles.list}>{sessions.map((session) => {
      const reconciled = session.status === "RECONCILED";
      return <article className={styles.row} key={session.id}>
        <span className={styles.rowTitle}><strong>{barberNames[session.barber_id] ?? "Profissional"}</strong><small>{formatBusinessDate(session.business_date)} · esperado {formatCents(session.expected_cents)}{reconciled && session.reconciled_cents !== null ? ` · apurado ${formatCents(session.reconciled_cents)}` : ""}</small></span>
        <StatusChip active={reconciled} label={reconciled ? "Conciliado" : "Aberto"} />
        <span className={styles.rowActions}>{!reconciled && <button className={`${styles.button} ${styles.buttonSmall}`} type="button" onClick={() => openSession(session)}>Conciliar e fechar</button>}</span>
      </article>;
    })}</div>}
    {selected && <div className="modal-layer" role="presentation"><button type="button" className="modal-layer__backdrop" aria-label="Fechar conciliação" onClick={closeSession} /><form className="form-modal" role="dialog" aria-modal="true" aria-label={`Conciliar caixa de ${barberNames[selected.barber_id] ?? "profissional"}`} onSubmit={reconcile}>
      <div className="form-modal__head"><span><small>Caixa diário</small><strong>Conciliar e fechar</strong></span><button type="button" className="icon-button" onClick={closeSession} aria-label="Fechar"><X size={18} aria-hidden="true" /></button></div>
      <div className="form-modal__body">
        <p>Barbeiro: <strong>{barberNames[selected.barber_id] ?? "Profissional"}</strong></p>
        <p>Esperado no caixa: <strong>{formatCents(totalExpected)}</strong></p>
        <div className={styles.reconciliationTable} role="table" aria-label="Valores por conta financeira">
          <div className={styles.reconciliationHeader} role="row"><span>Conta financeira</span><span>Valor</span><span>Valor apurado</span></div>
          {selectedRows.length === 0 ? <p className={styles.muted}>Nenhum recebimento pendente neste caixa.</p> : selectedRows.map((row) => <div className={styles.reconciliationRow} role="row" key={row.financial_account_id}><strong>{accountById.get(row.financial_account_id)?.name ?? "Conta financeira"}</strong><span>{formatCents(row.expected_cents)}</span><Field label={`Valor apurado — ${accountById.get(row.financial_account_id)?.name ?? "conta financeira"}`}><input aria-label={`Valor apurado ${accountById.get(row.financial_account_id)?.name ?? "conta financeira"}`} name={`reconciled-${row.financial_account_id}`} inputMode="decimal" value={reconciledByAccount[row.financial_account_id] ?? "0,00"} onChange={(event) => setReconciledByAccount((current) => ({ ...current, [row.financial_account_id]: event.target.value }))} /></Field></div>)}
        </div>
        <div className={styles.reconciliationTotals}><div><span>Total da conciliação</span><strong>{formatCents(totalReconciled)}</strong></div><div><span>Diferença</span><strong className={difference === 0 ? styles.reconciliationBalanced : styles.reconciliationDivergence}>{difference >= 0 ? "+" : "−"}{formatCents(Math.abs(difference))}</strong></div></div>
        <Field label="Motivo da diferença" wide><input name="reason" placeholder="Obrigatório quando o apurado for diferente" /></Field>
      </div>
      <div className="form-modal__footer"><button type="button" className={`${styles.button} ${styles.buttonSoft}`} onClick={closeSession}>Cancelar</button><button type="submit" className={styles.button}>Confirmar conciliação</button></div>
    </form></div>}
  </>;
}
