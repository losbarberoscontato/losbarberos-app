"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { connectedClient, assertResult } from "./mutation-utils";
import { Field } from "./shared";
import styles from "./connected-manager.module.css";

export function WhatsAppCampaignDialog({ organizationId, messageKey, body, onClose }: {
  organizationId: string; messageKey: string; body: string; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [query, setQuery] = useState("");
  const [all, setAll] = useState(true);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [customers, setCustomers] = useState<Array<{ id: string; full_name: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const requestId = useRef<string | null>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    if (all) return;
    let active = true;
    const timer = setTimeout(() => {
      void Promise.resolve(connectedClient().rpc("get_whatsapp_campaign_audience", { p_organization_id: organizationId, p_search: query }))
        .then(({ data, error: failure }) => { if (active) { setCustomers(failure ? [] : data ?? []); if (failure) setError("Não foi possível consultar clientes."); } })
        .catch(() => { if (active) { setCustomers([]); setError("Não foi possível consultar clientes."); } });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [organizationId, query, all]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !confirmed) return;
    setBusy(true); setError("");
    requestId.current ??= crypto.randomUUID();
    try {
      await assertResult(await connectedClient().rpc("schedule_whatsapp_campaign_local", {
        p_organization_id: organizationId, p_id: requestId.current, p_message_key: messageKey,
        p_body: body, p_local_date: date, p_local_time: time,
        p_customer_ids: all ? null : Object.keys(selected),
      }));
      onClose();
    } catch { setError("Não foi possível agendar. Verifique horário, público e se a automação está salva e ativa."); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className={`${styles.modal} ${styles.modalWide}`} onCancel={(event) => { if (busy) event.preventDefault(); else onClose(); }} aria-labelledby="campaign-title">
    <header className={styles.modalHeader}><h2 id="campaign-title">Agendar mensagem</h2><button type="button" className={styles.modalClose} disabled={busy} onClick={onClose} aria-label="Fechar">×</button></header>
    <form className={styles.form} onSubmit={submit}>
      <p>Horário local da barbearia. Envio entre 09h e 18h, conforme consentimento e limite de frequência.</p>
      <Field label="Data"><input type="date" required value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} /></Field>
      <Field label="Horário"><input type="time" required min="09:00" max="17:59" value={time} onChange={(e) => setTime(e.target.value)} disabled={busy} /></Field>
      <Field label="Público"><select value={all ? "all" : "selected"} onChange={(e) => setAll(e.target.value === "all")} disabled={busy}><option value="all">Todos os clientes elegíveis</option><option value="selected">Selecionar clientes</option></select></Field>
      {!all && <fieldset disabled={busy}><legend>Clientes selecionados: {Object.keys(selected).length}</legend><input aria-label="Buscar cliente" value={query} onChange={(e) => setQuery(e.target.value)} />{customers.map((c) => <label key={c.id} className={styles.automationRow}><span>{c.full_name}</span><input type="checkbox" checked={c.id in selected} onChange={(e) => setSelected((current) => { const next = { ...current }; if (e.target.checked) next[c.id] = c.full_name; else delete next[c.id]; return next; })} /></label>)}</fieldset>}
      <p><strong>Prévia</strong></p><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{body.replaceAll("{cliente}", "Nome do cliente")}</pre>
      <label><input type="checkbox" required checked={confirmed} disabled={busy} onChange={(e) => setConfirmed(e.target.checked)} /> Conferi a mensagem, o público e o horário.</label>
      {error && <p role="alert">{error}</p>}
      <button className={styles.button} disabled={busy || !confirmed || (!all && !Object.keys(selected).length)}>{busy ? "Agendando…" : "Confirmar agendamento"}</button>
    </form>
  </dialog>;
}
