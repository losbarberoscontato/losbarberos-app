"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui";
import type { loadAgendaData } from "./server";
import type { AwaitedReturn } from "./utility-types";
import type { AppointmentRecord, AppointmentStatus } from "./types";
import { BUSINESS_SLOT_INTERVAL_MINUTES, formatCents, formatRange, isAlignedToSlot, localDateTimeToIso, parsePostgresRange } from "./format";
import { ActionMessage, EmptyState, Field, Panel, StatusChip } from "./shared";
import { assertResult, connectedClient, runMutation } from "./mutation-utils";
import styles from "./connected-manager.module.css";

type Props = AwaitedReturn<typeof loadAgendaData>;
const statuses: Array<AppointmentStatus | "ALL"> = ["ALL", "HELD", "PENDING_PAYMENT", "CONFIRMED", "IN_SERVICE", "COMPLETED", "CANCELED", "NO_SHOW", "EXPIRED"];
const statusLabels: Record<AppointmentStatus | "ALL", string> = {
  ALL: "Todos",
  HELD: "Aguardando pagamento",
  PENDING_PAYMENT: "Pendente de pagamento",
  CONFIRMED: "Confirmado",
  IN_SERVICE: "Em serviço",
  COMPLETED: "Concluído",
  CANCELED: "Cancelado",
  NO_SHOW: "Não compareceu",
  EXPIRED: "Expirado",
};

export function AgendaManager(props: Props) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [customerQuery, setCustomerQuery] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [quickCustomerOpen, setQuickCustomerOpen] = useState(false);
  const [quickCustomerName, setQuickCustomerName] = useState("");
  const [quickCustomerPhone, setQuickCustomerPhone] = useState("");
  const [createdCustomers, setCreatedCustomers] = useState<Props["customers"]>([]);
  const [status, setStatus] = useState<AppointmentStatus | "ALL">("ALL");
  const [date, setDate] = useState("");
  const [rescheduling, setRescheduling] = useState<AppointmentRecord | null>(null);
  const blocked = props.billingStatus === "BLOCKED";
  const availableCustomers = useMemo(() => [...props.customers, ...createdCustomers], [createdCustomers, props.customers]);
  const customerById = useMemo(() => new Map(availableCustomers.map((item) => [item.id, item])), [availableCustomers]);
  const barberById = useMemo(() => new Map(props.barbers.map((item) => [item.id, item])), [props.barbers]);
  const financialById = useMemo(() => new Map(props.financial.map((item) => [item.appointment_id, item])), [props.financial]);
  const matchingCustomers = useMemo(() => {
    const query = customerQuery.trim().toLocaleLowerCase("pt-BR");
    if (!query) return [];
    return availableCustomers.filter((customer) => `${customer.full_name} ${customer.phone_e164 ?? ""}`.toLocaleLowerCase("pt-BR").includes(query));
  }, [availableCustomers, customerQuery]);
  const selectedCustomer = availableCustomers.find((customer) => customer.id === selectedCustomerId) ?? null;
  const filtered = props.appointments.filter((appointment) => {
    if (status !== "ALL" && appointment.status !== status) return false;
    if (!date) return true;
    const period = parsePostgresRange(appointment.service_period);
    return period && new Intl.DateTimeFormat("en-CA", { timeZone: props.organization.timezone }).format(period.start) === date;
  });

  async function createAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const [type, id] = String(data.get("selection") ?? "").split(":");
    const saved = await runMutation(setMessage, async () => {
      if (blocked) throw new Error("A assinatura está bloqueada para novas reservas.");
      if (!type || !id) throw new Error("Escolha um serviço ou pacote.");
      if (!selectedCustomerId) throw new Error("Busque e selecione um cliente.");
      const startsAt = String(data.get("starts_at") ?? "");
      if (!isAlignedToSlot(startsAt, BUSINESS_SLOT_INTERVAL_MINUTES)) {
        throw new Error(`Escolha um horário em intervalos de ${BUSINESS_SLOT_INTERVAL_MINUTES} minutos.`);
      }
      await assertResult(await connectedClient().rpc("create_manual_appointment", {
        p_organization_id: props.organizationId,
        p_customer_id: selectedCustomerId,
        p_barber_id: String(data.get("barber_id")),
        p_starts_at: localDateTimeToIso(startsAt, props.organization.timezone),
        p_selections: [{ type, id, quantity: 1 }],
        p_override_reason: String(data.get("override_reason") ?? "").trim() || null,
        p_notes: String(data.get("notes") ?? "").trim() || null,
      }));
    }, "Agendamento confirmado com saldo no balcão.");
    if (saved) { form.reset(); setCustomerQuery(""); setSelectedCustomerId(""); setNewOpen(false); router.refresh(); }
  }

  async function createQuickCustomer() {
    const fullName = quickCustomerName.trim();
    if (!fullName) return;
    const saved = await runMutation(setMessage, async () => {
      const result = await connectedClient().from("customers").insert({
        organization_id: props.organizationId,
        full_name: fullName,
        phone_e164: quickCustomerPhone.trim() || null,
        active: true,
      }).select("id,organization_id,full_name,phone_e164,email,birth_date,notes,active,created_at").single();
      await assertResult(result);
      if (!result.data) throw new Error("Cliente não retornado após o cadastro.");
      setCreatedCustomers((current) => [...current, result.data]);
      setSelectedCustomerId(result.data.id);
      setCustomerQuery(result.data.full_name);
    }, "Cliente cadastrado e selecionado.");
    if (saved) { setQuickCustomerOpen(false); setQuickCustomerName(""); setQuickCustomerPhone(""); }
  }

  async function transition(appointment: AppointmentRecord, next: "IN_SERVICE" | "COMPLETED" | "NO_SHOW") {
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("transition_appointment", {
        p_appointment_id: appointment.id,
        p_expected_status: appointment.status,
        p_new_status: next,
        p_reason: `manager_${next.toLowerCase()}`,
      }));
    }, next === "IN_SERVICE" ? "Atendimento iniciado." : next === "COMPLETED" ? "Atendimento concluído; comissão lançada." : "No-show registrado.");
    if (saved) router.refresh();
  }

  async function cancel(appointment: AppointmentRecord) {
    const reason = window.prompt("Motivo do cancelamento:", "Cancelado pelo gestor");
    if (!reason) return;
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("cancel_appointment", { p_appointment_id: appointment.id, p_reason: reason, p_requested_by_customer: false }));
    }, "Agendamento cancelado. Reembolso, quando devido, foi encaminhado.");
    if (saved) router.refresh();
  }

  async function confirmWithoutPayment(appointment: AppointmentRecord) {
    const reason = window.prompt("Motivo para confirmar mantendo o saldo pendente:", "Pagamento combinado no balcão");
    if (!reason?.trim()) return;
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("confirm_appointment_without_payment", {
        p_appointment_id: appointment.id,
        p_reason: reason.trim(),
      }));
    }, "Agendamento confirmado; saldo continua pendente.");
    if (saved) router.refresh();
  }

  async function reschedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rescheduling) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const saved = await runMutation(setMessage, async () => {
      if (blocked) throw new Error("A assinatura está bloqueada para reagendamentos.");
      const startsAt = String(data.get("starts_at") ?? "");
      if (!isAlignedToSlot(startsAt, BUSINESS_SLOT_INTERVAL_MINUTES)) {
        throw new Error(`Escolha um horário em intervalos de ${BUSINESS_SLOT_INTERVAL_MINUTES} minutos.`);
      }
      await assertResult(await connectedClient().rpc("reschedule_appointment", {
        p_appointment_id: rescheduling.id,
        p_new_barber_id: String(data.get("barber_id")),
        p_new_starts_at: localDateTimeToIso(startsAt, props.organization.timezone),
        p_selections: null,
        p_override_reason: String(data.get("override_reason") ?? "").trim() || null,
      }));
    }, "Agendamento reagendado atomicamente.");
    if (saved) { setRescheduling(null); router.refresh(); }
  }

  return <div className={styles.stack}>
    <PageHeader title="Agenda" description="Reservas reais; conflito final decidido pela constraint do banco." />
    {blocked && <ActionMessage tone="warning" message="Assinatura bloqueada: criar e reagendar estão desabilitados. Iniciar, concluir, no-show, cancelar e reembolsar reservas existentes continuam disponíveis." />}
    <ActionMessage message={message} />
    <Panel title="Compromissos" description={`${filtered.length} no filtro`} action={<button className={styles.button} disabled={blocked || !props.barbers.length || !props.services.length} onClick={() => setNewOpen((value) => !value)} type="button">Novo agendamento</button>}>
      {newOpen && <form className={styles.form} onSubmit={createAppointment}>
        <Field label="Cliente" wide><input value={selectedCustomer?.full_name ?? customerQuery} onChange={(event) => { setCustomerQuery(event.target.value); setSelectedCustomerId(""); }} placeholder="Busque por nome ou telefone" required /></Field>
        {customerQuery.trim() && !selectedCustomerId && <div className={styles.formWide}><div className={styles.list}>{matchingCustomers.map((customer) => <button className={`${styles.row} ${styles.buttonSoft}`} key={customer.id} type="button" aria-label={`Selecionar ${customer.full_name}`} onClick={() => { setSelectedCustomerId(customer.id); setCustomerQuery(customer.full_name); }}><span className={styles.rowTitle}><strong>{customer.full_name}</strong><small>{customer.phone_e164 ?? "Sem telefone"}</small></span></button>)}{matchingCustomers.length === 0 && <button className={styles.button} type="button" onClick={() => { setQuickCustomerName(customerQuery); setQuickCustomerOpen(true); }}>Cadastrar novo cliente</button>}</div></div>}
        {quickCustomerOpen && <div className={`${styles.formWide} ${styles.toolbarGroup}`}><Field label="Nome do novo cliente"><input aria-label="Nome do novo cliente" value={quickCustomerName} onChange={(event) => setQuickCustomerName(event.target.value)} required /></Field><Field label="Telefone"><input value={quickCustomerPhone} onChange={(event) => setQuickCustomerPhone(event.target.value)} placeholder="+5511999999999" /></Field><button className={styles.button} type="button" onClick={createQuickCustomer}>Salvar cliente</button></div>}
        {selectedCustomer && <div className={styles.formWide}><small className={styles.muted}>{selectedCustomer.full_name} selecionado</small></div>}
        <Field label="Profissional"><select name="barber_id" required>{props.barbers.map((item) => <option key={item.id} value={item.id}>{item.display_name}</option>)}</select></Field>
        <Field label="Serviço ou pacote"><select name="selection" required><option value="">Selecione</option><optgroup label="Serviços">{props.services.map((item) => <option key={item.id} value={`SERVICE:${item.id}`}>{item.name} · {formatCents(item.price_cents)}</option>)}</optgroup><optgroup label="Pacotes">{props.packages.map((item) => <option key={item.id} value={`PACKAGE:${item.id}`}>{item.name} · {formatCents(item.price_cents)}</option>)}</optgroup></select></Field>
        <Field label="Início"><input name="starts_at" type="datetime-local" step={BUSINESS_SLOT_INTERVAL_MINUTES * 60} required /></Field>
        <Field label="Motivo fora da escala"><input name="override_reason" placeholder="Obrigatório somente fora da escala" /></Field>
        <Field label="Observações"><input name="notes" /></Field>
        <div className={`${styles.toolbarGroup} ${styles.formWide}`}><button className={styles.button}>Confirmar sem pagamento</button><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => setNewOpen(false)}>Cancelar</button></div>
      </form>}
      {rescheduling && <form className={styles.form} onSubmit={reschedule}>
        <div className={styles.formWide}><strong>Reagendar {customerById.get(rescheduling.customer_id)?.full_name}</strong><p className={styles.muted}>Itens e preços são preservados. O slot antigo só é liberado no commit atômico.</p></div>
        <Field label="Profissional"><select name="barber_id" defaultValue={rescheduling.barber_id}>{props.barbers.map((item) => <option key={item.id} value={item.id}>{item.display_name}</option>)}</select></Field>
        <Field label="Novo início"><input name="starts_at" type="datetime-local" step={BUSINESS_SLOT_INTERVAL_MINUTES * 60} required /></Field>
        <Field label="Motivo fora da escala" wide><input name="override_reason" /></Field>
        <div className={`${styles.toolbarGroup} ${styles.formWide}`}><button className={styles.button}>Proteger novo slot</button><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => setRescheduling(null)}>Cancelar</button></div>
      </form>}
      <div className={styles.toolbar}><div className={styles.tabs} role="tablist" aria-label="Status">{statuses.map((item) => <button className={`${styles.tab} ${status === item ? styles.tabActive : ""}`} type="button" role="tab" aria-selected={status === item} key={item} onClick={() => setStatus(item)}>{statusLabels[item]}</button>)}</div><label className={styles.field}><span>Data</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label></div>
      {filtered.length === 0 ? <EmptyState title="Agenda vazia">Nenhum dado demonstrativo foi carregado. Ajuste o filtro ou crie uma reserva real.</EmptyState> : <div className={styles.timeline}>{filtered.map((appointment) => {
        const financial = financialById.get(appointment.id);
        return <article className={styles.appointment} key={appointment.id}>
          <span className={styles.appointmentTime}>{formatRange(appointment.service_period, props.organization.timezone)}</span>
          <span className={styles.rowTitle}><strong>{customerById.get(appointment.customer_id)?.full_name ?? "Cliente"}</strong><small>{barberById.get(appointment.barber_id)?.display_name ?? "Profissional"} · {appointment.source}</small></span>
          <span className={styles.rowTitle}><StatusChip active={["CONFIRMED", "IN_SERVICE", "COMPLETED"].includes(appointment.status)} label={statusLabels[appointment.status]} /><small>{financial?.financial_status ?? "UNPAID"} · saldo {formatCents(financial?.outstanding_cents)}</small></span>
          <strong className={styles.appointmentValue}>{formatCents(appointment.total_cents_snapshot)}</strong>
          <span className={styles.rowActions}>
            {["HELD", "PENDING_PAYMENT"].includes(appointment.status) && <button className={`${styles.button} ${styles.buttonSmall}`} type="button" onClick={() => confirmWithoutPayment(appointment)}>Confirmar sem pagamento</button>}
            {appointment.status === "CONFIRMED" && <><button className={`${styles.button} ${styles.buttonSmall}`} type="button" onClick={() => transition(appointment, "IN_SERVICE")}>Iniciar</button><button className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} disabled={blocked} type="button" onClick={() => setRescheduling(appointment)}>Reagendar</button><button className={`${styles.button} ${styles.buttonDanger} ${styles.buttonSmall}`} type="button" onClick={() => transition(appointment, "NO_SHOW")}>No-show</button></>}
            {appointment.status === "IN_SERVICE" && <button className={`${styles.button} ${styles.buttonSmall}`} type="button" onClick={() => transition(appointment, "COMPLETED")}>Concluir</button>}
            {["HELD", "PENDING_PAYMENT", "CONFIRMED"].includes(appointment.status) && <button className={`${styles.button} ${styles.buttonDanger} ${styles.buttonSmall}`} type="button" onClick={() => cancel(appointment)}>Cancelar</button>}
          </span>
        </article>;
      })}</div>}
    </Panel>
  </div>;
}
