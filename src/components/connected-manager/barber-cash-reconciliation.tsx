"use client";

import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { centsFromInput, formatCents } from "./format";
import { assertResult, connectedClient, runMutation } from "./mutation-utils";
import { EmptyState, Field, StatusChip } from "./shared";
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

function formatBusinessDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(`${value}T12:00:00`));
}

export function BarberCashSessionReconciliation({ sessions, barberNames, demoMode, setMessage, onSaved }: { sessions: BarberCashSession[]; barberNames: Record<string, string>; demoMode?: boolean; setMessage: (value: string) => void; onSaved: () => void }) {
  const [selected, setSelected] = useState<BarberCashSession | null>(null);

  async function reconcile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    if (demoMode) { setMessage("Modo demonstração: conciliação não altera dados."); return; }
    const data = new FormData(event.currentTarget);
    const amount = centsFromInput(data.get("counted"));
    const reason = String(data.get("reason") ?? "").trim();
    if (amount !== selected.expected_cents && !reason) {
      setMessage("Informe o motivo obrigatório para fechar um caixa com diferença.");
      return;
    }
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("reconcile_barber_cash_session", {
        p_session_id: selected.id,
        p_reconciled_cents: amount,
        p_variance_reason: reason || null,
      }));
    }, "Caixa do Barbeiro conciliado e confirmado nas contas selecionadas.");
    if (saved) { setSelected(null); onSaved(); }
  }

  return <>
    {!sessions.length ? <EmptyState title="Nenhum caixa diário aberto">Os caixas surgem quando um Barbeiro com permissão recebe um atendimento.</EmptyState> : <div className={styles.list}>{sessions.map((session) => {
      const reconciled = session.status === "RECONCILED";
      return <article className={styles.row} key={session.id}>
        <span className={styles.rowTitle}><strong>{barberNames[session.barber_id] ?? "Profissional"}</strong><small>{formatBusinessDate(session.business_date)} · esperado {formatCents(session.expected_cents)}{reconciled && session.reconciled_cents !== null ? ` · contado ${formatCents(session.reconciled_cents)}` : ""}</small></span>
        <StatusChip active={reconciled} label={reconciled ? "Conciliado" : "Aberto"} />
        <span className={styles.rowActions}>{!reconciled && <button className={`${styles.button} ${styles.buttonSmall}`} type="button" onClick={() => setSelected(session)}>Conciliar e fechar</button>}</span>
      </article>;
    })}</div>}
    {selected && <div className="modal-layer" role="presentation"><button type="button" className="modal-layer__backdrop" aria-label="Fechar conciliação" onClick={() => setSelected(null)} /><form className="form-modal" role="dialog" aria-modal="true" aria-label={`Conciliar caixa de ${barberNames[selected.barber_id] ?? "profissional"}`} onSubmit={reconcile}><div className="form-modal__head"><span><small>Caixa diário</small><strong>Conciliar e fechar</strong></span><button type="button" className="icon-button" onClick={() => setSelected(null)} aria-label="Fechar"><X size={18} aria-hidden="true" /></button></div><div className="form-modal__body"><p>Barbeiro: <strong>{barberNames[selected.barber_id] ?? "Profissional"}</strong></p><p>Esperado: <strong>{formatCents(selected.expected_cents)}</strong></p><Field label="Valor contado (R$)"><input name="counted" inputMode="decimal" required defaultValue={(selected.expected_cents / 100).toFixed(2).replace(".", ",")} /></Field><Field label="Motivo da diferença" wide><input name="reason" placeholder="Obrigatório quando contado for diferente" /></Field></div><div className="form-modal__footer"><button type="button" className={`${styles.button} ${styles.buttonSoft}`} onClick={() => setSelected(null)}>Cancelar</button><button type="submit" className={styles.button}>Confirmar conciliação</button></div></form></div>}
  </>;
}
