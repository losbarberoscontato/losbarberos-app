"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { PageHeader } from "@/components/ui";
import type { loadCustomersData } from "./server";
import type { AwaitedReturn } from "./utility-types";
import type { CustomerRecord } from "./types";
import { ActionMessage, EmptyState, Field, Panel, StatusChip } from "./shared";
import { assertResult, connectedClient, runMutation } from "./mutation-utils";
import styles from "./connected-manager.module.css";
import { normalizePhoneE164 } from "@/lib/phone";
import { formatCents, formatRange, parsePostgresRange } from "./format";

type Props = AwaitedReturn<typeof loadCustomersData>;
type CustomerFilter = "ACTIVE" | "INACTIVE";

const inactivationReasons = [
  ["NEIGHBORHOOD_CHANGE", "Mudança de bairro"],
  ["CITY_CHANGE", "Mudança de cidade"],
  ["DISSATISFACTION", "Insatisfação"],
  ["LOST_CONTACT", "Perda de contato"],
  ["OTHER", "Outro motivo"],
] as const;

export function CustomersManager({ organizationId, customers, appointments, appointmentItems, financial, barbers, statusEvents }: Props) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(customers.length === 0);
  const [editing, setEditing] = useState<CustomerRecord | null>(null);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [mergeOpen, setMergeOpen] = useState(false);
  const [historyCustomer, setHistoryCustomer] = useState<CustomerRecord | null>(null);
  const [customerFilter, setCustomerFilter] = useState<CustomerFilter>("ACTIVE");
  const [pendingInactivation, setPendingInactivation] = useState<CustomerRecord | null>(null);
  const [inactivationReason, setInactivationReason] = useState("");
  const [customInactivationReason, setCustomInactivationReason] = useState("");
  const [todayTimestamp] = useState(() => Date.now());
  const filtered = customers.filter((customer) => customer.active === (customerFilter === "ACTIVE") && `${customer.full_name} ${customer.phone_e164 ?? ""} ${customer.email ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  const itemsByAppointment = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const item of [...appointmentItems].sort((left, right) => left.position - right.position)) {
      map.set(item.appointment_id, [...(map.get(item.appointment_id) ?? []), item.service_name_snapshot]);
    }
    return map;
  }, [appointmentItems]);
  const financialByAppointment = useMemo(() => new Map(financial.map((item) => [item.appointment_id, item])), [financial]);
  const barberById = useMemo(() => new Map(barbers.map((item) => [item.id, item.display_name])), [barbers]);
  const rescheduledIds = useMemo(() => new Set(statusEvents.filter((event) => event.reason === "appointment_rescheduled").map((event) => event.appointment_id)), [statusEvents]);

  function customerAppointments(customerId: string) {
    return appointments.filter((appointment) => appointment.customer_id === customerId && appointment.status === "COMPLETED" && (financialByAppointment.get(appointment.id)?.net_paid_cents ?? 0) > 0).sort((left, right) => {
      const leftStart = parsePostgresRange(left.service_period)?.start.valueOf() ?? 0;
      const rightStart = parsePostgresRange(right.service_period)?.start.valueOf() ?? 0;
      return rightStart - leftStart;
    });
  }

  function lastVisitLabel(customerId: string) {
    const completed = customerAppointments(customerId).filter((appointment) => appointment.status === "COMPLETED").map((appointment) => parsePostgresRange(appointment.service_period)?.start).filter((date): date is Date => Boolean(date && date.valueOf() <= todayTimestamp));
    if (!completed.length) return "Última visita ainda não registrada";
    const days = Math.max(0, Math.floor((todayTimestamp - Math.max(...completed.map((date) => date.valueOf()))) / 86_400_000));
    return `Última visita deste cliente foi há ${days} ${days === 1 ? "dia" : "dias"}`;
  }

  function appointmentStatus(appointment: Props["appointments"][number]) {
    if (appointment.status === "CONFIRMED" && rescheduledIds.has(appointment.id)) return "Reagendado";
    const labels: Record<string, string> = { COMPLETED: "Atendimento feito", CANCELED: "Cancelado", NO_SHOW: "Não compareceu", CONFIRMED: "Confirmado", IN_SERVICE: "Em serviço", HELD: "Aguardando pagamento", PENDING_PAYMENT: "Pendente de pagamento", EXPIRED: "Expirado" };
    return labels[appointment.status] ?? appointment.status;
  }

  function openEdit(customer: CustomerRecord) {
    setEditing(customer);
    setFormOpen(true);
    setMessage("");
  }

  function closeForm() {
    setFormOpen(false);
    setEditing(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const rawPhone = String(data.get("phone_e164") ?? "").trim();
    const normalizedPhone = normalizePhoneE164(rawPhone);
    if (rawPhone && !normalizedPhone) {
      setMessage("Informe um telefone válido com DDD e, se necessário, DDI.");
      return;
    }
    const canonicalPayload = {
      organization_id: organizationId,
      full_name: String(data.get("full_name") ?? "").trim(),
      phone_e164: normalizedPhone,
      email: String(data.get("email") ?? "").trim().toLowerCase() || null,
      birth_date: String(data.get("birth_date") ?? "") || null,
      notes: String(data.get("notes") ?? "").trim() || null,
    };
    const payload = editing?.auth_user_id
      ? { notes: canonicalPayload.notes }
      : canonicalPayload;
    const saved = await runMutation(setMessage, async () => {
      const client = connectedClient();
      const result = editing
        ? await client.from("customers").update(payload).eq("id", editing.id).eq("organization_id", organizationId)
        : await client.from("customers").insert(payload);
      await assertResult(result);
    }, editing ? "Cliente atualizado." : "Cliente cadastrado.");
    if (saved) {
      form.reset();
      setEditing(null);
      setFormOpen(false);
      router.refresh();
    }
  }

  function openInactivation(customer: CustomerRecord) {
    setPendingInactivation(customer);
    setInactivationReason("");
    setCustomInactivationReason("");
  }

  function closeInactivation() {
    setPendingInactivation(null);
    setInactivationReason("");
    setCustomInactivationReason("");
  }

  async function toggle(customer: CustomerRecord) {
    if (customer.active) return openInactivation(customer);
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().from("customers").update({ active: true, inactivation_reason: null, inactivated_at: null }).eq("id", customer.id).eq("organization_id", organizationId));
    }, "Cliente reativado.");
    if (saved) router.refresh();
  }

  async function confirmInactivation() {
    if (!pendingInactivation || !inactivationReason) return;
    const reason = inactivationReason === "OTHER" ? customInactivationReason.trim() : inactivationReasons.find(([value]) => value === inactivationReason)?.[1] ?? "";
    if (!reason) return;
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().from("customers").update({ active: false, inactivation_reason: reason, inactivated_at: new Date().toISOString() }).eq("id", pendingInactivation.id).eq("organization_id", organizationId));
    }, "Cliente inativado.");
    if (saved) { closeInactivation(); router.refresh(); }
  }

  async function merge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const sourceId = String(data.get("source_customer_id"));
    const targetId = String(data.get("target_customer_id"));
    const reason = String(data.get("reason") ?? "").trim();
    if (sourceId === targetId) {
      setMessage("Escolha dois cadastros diferentes.");
      return;
    }
    if (!window.confirm("Mesclar estes cadastros? O cadastro de origem será inativado e o histórico migrará para o destino.")) return;
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("merge_customers", {
        p_organization_id: organizationId,
        p_source_customer_id: sourceId,
        p_target_customer_id: targetId,
        p_reason: reason,
      }));
    }, "Cadastros mesclados com auditoria.");
    if (saved) { setMergeOpen(false); router.refresh(); }
  }

  return <div className={styles.stack}>
    <PageHeader title="Clientes" description="Cadastros reais isolados por RLS na sua organização." />
    <Panel title="Base de clientes" titleAdornment={<select aria-label="Filtro de clientes" className="customer-filter" value={customerFilter} onChange={(event) => setCustomerFilter(event.target.value as CustomerFilter)}><option value="ACTIVE">Ativos</option><option value="INACTIVE">Inativos</option></select>} description={`${customers.filter((item) => item.active).length} ativos`} action={<button className={styles.button} type="button" onClick={() => { setEditing(null); setFormOpen(true); }}>Novo cliente</button>}>
      <ActionMessage message={message} tone={message.toLowerCase().includes("erro") || message.toLowerCase().includes("negado") ? "error" : "info"} />
      {customers.length > 1 && <div className={styles.toolbarGroup}><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => setMergeOpen((value) => !value)}>Mesclar cadastros</button></div>}
      {mergeOpen && <form className={styles.form} onSubmit={merge}>
        <Field label="Cadastro de origem"><select name="source_customer_id" required>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.full_name} · {customer.phone_e164 ?? customer.email ?? "sem contato"}</option>)}</select></Field>
        <Field label="Cadastro de destino"><select name="target_customer_id" required defaultValue={customers[1]?.id}>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.full_name} · {customer.phone_e164 ?? customer.email ?? "sem contato"}</option>)}</select></Field>
        <Field label="Motivo" wide><input name="reason" required minLength={3} maxLength={500} placeholder="Duplicidade confirmada pelo gestor" /></Field>
        <div className={`${styles.toolbarGroup} ${styles.formWide}`}><button className={styles.button}>Mesclar com auditoria</button><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => setMergeOpen(false)}>Cancelar</button></div>
      </form>}
      {formOpen && <div className="modal-layer" role="presentation">
        <button className="modal-layer__backdrop" type="button" aria-label="Fechar" onClick={closeForm} />
        <form className="form-modal" role="dialog" aria-modal="true" aria-label={editing ? "Editar cliente" : "Novo cliente"} onSubmit={submit} key={editing?.id ?? "new"}>
          <div className="form-modal__head"><span><small>{editing ? "Editar cliente" : "Novo cliente"}</small><strong>{editing ? "Atualize os dados" : "Cadastre um cliente"}</strong></span><button type="button" className="icon-button" onClick={closeForm} aria-label="Fechar"><X size={19} /></button></div>
          <div className="form-modal__body">
        {editing?.auth_user_id && <p className="customer-canonical-notice">Dados controlados pelo cliente. Nome, telefone, e-mail e nascimento são atualizados pela conta global.</p>}
        <Field label="Nome completo"><input name="full_name" required minLength={2} maxLength={160} defaultValue={editing?.full_name} disabled={Boolean(editing?.auth_user_id)} /></Field>
        <Field label="Telefone"><input name="phone_e164" inputMode="tel" placeholder="11999999999 ou +5511999999999" pattern="[+0-9][0-9\s().-]{7,20}" defaultValue={editing?.phone_e164 ?? ""} disabled={Boolean(editing?.auth_user_id)} /></Field>
        <Field label="E-mail"><input name="email" type="email" defaultValue={editing?.email ?? ""} disabled={Boolean(editing?.auth_user_id)} /></Field>
        <Field label="Nascimento (opcional)"><input name="birth_date" type="date" defaultValue={editing?.birth_date ?? ""} disabled={Boolean(editing?.auth_user_id)} /></Field>
        <Field label="Observações" wide><textarea name="notes" maxLength={1000} defaultValue={editing?.notes ?? ""} /></Field>
          </div>
          <div className="form-modal__footer"><button className="button button--ghost" type="button" onClick={closeForm}>Cancelar</button><button className="button button--dark" type="submit">{editing ? "Salvar alterações" : "Cadastrar"}</button></div>
        </form>
      </div>}
      <div className={styles.toolbar}><label className={styles.field}><span>Buscar</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome, telefone ou e-mail" /></label></div>
      {filtered.length === 0 ? <EmptyState title={customers.length ? "Nenhum resultado" : "Cadastre o primeiro cliente"}>{customers.length ? "Ajuste a busca ou altere o filtro." : "Clientes manuais podem ser criados sem login e vinculados depois."}</EmptyState> : <div className={styles.list}>{filtered.map((customer) => <article className={styles.row} key={customer.id}>
        <span className={styles.rowTitle}><strong>{customer.full_name}</strong><small>{lastVisitLabel(customer.id)}</small><small>{customer.email ?? "Sem e-mail"}</small></span>
        <span>{customer.phone_e164 ?? "Sem telefone"}</span>
        <span>{customer.birth_date ? new Date(`${customer.birth_date}T12:00:00`).toLocaleDateString("pt-BR") : "Nascimento não informado"}</span>
        <StatusChip active={customer.active} />
        <span className={styles.rowActions}>
          <button className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} type="button" onClick={() => setHistoryCustomer(customer)}>Ver Agendamentos</button>
          <button className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} type="button" onClick={() => openEdit(customer)}>Editar</button>
          <button className={`${styles.button} ${customer.active ? styles.buttonDanger : styles.buttonSoft} ${styles.buttonSmall}`} type="button" onClick={() => void toggle(customer)}>{customer.active ? "Inativar" : "Reativar"}</button>
        </span>
      </article>)}</div>}
      {pendingInactivation && <div className="modal-layer" role="presentation">
        <button className="modal-layer__backdrop" type="button" aria-label="Fechar inativação" onClick={closeInactivation} />
        <section className="form-modal customer-inactivation-modal" role="dialog" aria-modal="true" aria-label="Inativar cliente">
          <div className="form-modal__head"><span><small>Inativação de cliente</small><strong>Por que deseja inativar {pendingInactivation.full_name}?</strong></span><button type="button" className="icon-button" onClick={closeInactivation} aria-label="Fechar"><X size={19} /></button></div>
          <div className="form-modal__body"><label className="customer-inactivation-field"><span>Motivo da inativação</span><select aria-label="Motivo da inativação" value={inactivationReason} onChange={(event) => setInactivationReason(event.target.value)}><option value="">Selecione um motivo</option>{inactivationReasons.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{inactivationReason === "OTHER" && <label className="customer-inactivation-field"><span>Outro motivo</span><textarea aria-label="Outro motivo" value={customInactivationReason} onChange={(event) => setCustomInactivationReason(event.target.value)} maxLength={500} rows={3} placeholder="Descreva o motivo" /></label>}</div>
          <div className="form-modal__footer"><button className="button button--ghost" type="button" onClick={closeInactivation}>Cancelar</button><button className="button button--dark" type="button" disabled={!inactivationReason || (inactivationReason === "OTHER" && !customInactivationReason.trim())} onClick={() => void confirmInactivation()}>Confirmar inativação</button></div>
        </section>
      </div>}
      {historyCustomer && <div className="modal-layer" role="presentation">
        <button className="modal-layer__backdrop" type="button" aria-label="Fechar agendamentos" onClick={() => setHistoryCustomer(null)} />
        <section className="form-modal customer-history-modal" role="dialog" aria-modal="true" aria-label={`Agendamentos de ${historyCustomer.full_name}`}>
          <div className="form-modal__head"><span><small>Histórico do cliente</small><strong>Agendamentos de {historyCustomer.full_name}</strong></span><button type="button" className="icon-button" onClick={() => setHistoryCustomer(null)} aria-label="Fechar"><X size={19} /></button></div>
          <div className="form-modal__body">
            <div className="customer-history-summary"><span><small>Nome</small><strong>{historyCustomer.full_name}</strong></span><span><small>Telefone</small><strong>{historyCustomer.phone_e164 ?? "Não informado"}</strong></span><span><small>Nascimento</small><strong>{historyCustomer.birth_date ? new Date(`${historyCustomer.birth_date}T12:00:00`).toLocaleDateString("pt-BR") : "Não informado"}</strong></span></div>
            {customerAppointments(historyCustomer.id).length === 0 ? <EmptyState title="Sem agendamentos">Este cliente ainda não possui agendamentos registrados.</EmptyState> : <div className="customer-history-table-wrap"><table className="customer-history-table"><thead><tr><th>Data</th><th>Status</th><th>Serviço/Pacote</th><th>Valor pago</th><th>Barbeiro</th></tr></thead><tbody>{customerAppointments(historyCustomer.id).map((appointment) => <tr key={appointment.id}><td>{formatRange(appointment.service_period)}</td><td>{appointmentStatus(appointment)}</td><td>{itemsByAppointment.get(appointment.id)?.join(" + ") || "Atendimento"}</td><td>{formatCents(financialByAppointment.get(appointment.id)?.net_paid_cents ?? 0)}</td><td>{barberById.get(appointment.barber_id) ?? "Não informado"}</td></tr>)}</tbody></table></div>}
          </div>
          <div className="form-modal__footer"><button className="button button--ghost" type="button" onClick={() => setHistoryCustomer(null)}>Fechar</button></div>
        </section>
      </div>}
    </Panel>
  </div>;
}
