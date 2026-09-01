"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  CalendarPlus2,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Filter,
  MapPin,
  MessageCircle,
  Scissors,
  UserRound,
  X,
} from "lucide-react";
import { Avatar, PageHeader } from "@/components/ui";
import type { loadAgendaData } from "./server";
import type { AwaitedReturn } from "./utility-types";
import type { AppointmentRecord } from "./types";
import {
  agendaStatusFilterLabels,
  agendaStatusFilters,
  appointmentDisplayStatus,
  matchesAgendaStatusFilter,
  type AgendaStatusFilter,
} from "./appointment-display-status";
import {
  appointmentGeometry,
  currentTimeGeometry,
  dateKeyInTimezone,
  monthCells,
  shiftDateKey,
  weekDateKeys,
} from "./agenda-calendar";
import {
  BUSINESS_SLOT_INTERVAL_MINUTES,
  formatCents,
  formatRange,
  isAlignedToSlot,
  localDateTimeToIso,
  parsePostgresRange,
} from "./format";
import { ActionMessage, StatusChip } from "./shared";
import { AppointmentReceiptDialog } from "./cash-manager";
import { buildAppointmentReceiptDraft, type AppointmentReceiptDraft } from "./appointment-receipt";
import { assertResult, connectedClient, runMutation } from "./mutation-utils";
import styles from "./connected-manager.module.css";

type AgendaData = AwaitedReturn<typeof loadAgendaData>;
type Props = Omit<AgendaData, "appointmentItems"> & { appointmentItems?: AgendaData["appointmentItems"] };
type View = "day" | "week" | "month";

const hours = Array.from({ length: 14 }, (_, index) => `${String(index + 8).padStart(2, "0")}:00`);
function formatDate(dateKey: string, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" }) {
  return new Intl.DateTimeFormat("pt-BR", { ...options, timeZone: "UTC" }).format(new Date(`${dateKey}T12:00:00.000Z`));
}

function shiftMonth(dateKey: string, amount: number) {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + amount);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString().slice(0, 10);
}

export function AgendaManager(props: Props) {
  const router = useRouter();
  const timezone = props.organization.timezone;
  const todayKey = dateKeyInTimezone(new Date(), timezone);
  const [message, setMessage] = useState("");
  const [view, setView] = useState<View>("day");
  const [date, setDate] = useState(todayKey);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [barberFilter, setBarberFilter] = useState("ALL");
  const [status, setStatus] = useState<AgendaStatusFilter>("ALL");
  const [selected, setSelected] = useState<AppointmentRecord | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [agendaHelpOpen, setAgendaHelpOpen] = useState(false);
  const [customerQuery, setCustomerQuery] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [quickCustomerOpen, setQuickCustomerOpen] = useState(false);
  const [quickCustomerName, setQuickCustomerName] = useState("");
  const [quickCustomerPhone, setQuickCustomerPhone] = useState("");
  const [createdCustomers, setCreatedCustomers] = useState<Props["customers"]>([]);
  const [rescheduling, setRescheduling] = useState<AppointmentRecord | null>(null);
  const [receiptTarget, setReceiptTarget] = useState<AppointmentReceiptDraft | null>(null);
  const [currentTime, setCurrentTime] = useState<Date | null>(null);
  const blocked = props.billingStatus === "BLOCKED";
  const availableCustomers = useMemo(() => [...props.customers, ...createdCustomers].filter((customer) => customer.active), [createdCustomers, props.customers]);
  const customerById = useMemo(() => new Map(availableCustomers.map((item) => [item.id, item])), [availableCustomers]);
  const barberById = useMemo(() => new Map(props.barbers.map((item) => [item.id, item])), [props.barbers]);
  const financialById = useMemo(() => new Map(props.financial.map((item) => [item.appointment_id, item])), [props.financial]);
  const itemsByAppointment = useMemo(() => {
    const appointmentItems = props.appointmentItems ?? [];
    const map = new Map<string, string[]>();
    for (const item of [...appointmentItems].sort((left, right) => left.position - right.position)) {
      map.set(item.appointment_id, [...(map.get(item.appointment_id) ?? []), item.service_name_snapshot]);
    }
    return map;
  }, [props.appointmentItems]);
  const matchingCustomers = useMemo(() => {
    const query = customerQuery.trim().toLocaleLowerCase("pt-BR");
    if (!query) return [];
    return availableCustomers.filter((customer) => `${customer.full_name} ${customer.phone_e164 ?? ""}`.toLocaleLowerCase("pt-BR").includes(query));
  }, [availableCustomers, customerQuery]);
  const selectedCustomer = availableCustomers.find((customer) => customer.id === selectedCustomerId) ?? null;
  const filteredAppointments = useMemo(() => props.appointments.filter((appointment) => {
    if (!matchesAgendaStatusFilter(appointment, status)) return false;
    return barberFilter === "ALL" || appointment.barber_id === barberFilter;
  }), [barberFilter, props.appointments, status]);
  const displayedBarbers = barberFilter === "ALL" ? props.barbers : props.barbers.filter((barber) => barber.id === barberFilter);
  const weekDates = weekDateKeys(date);
  const month = monthCells(date);
  const nowLine = currentTime ? currentTimeGeometry(date, currentTime, timezone) : null;

  useEffect(() => {
    const updateCurrentTime = () => setCurrentTime(new Date());
    updateCurrentTime();
    const millisecondsUntilNextFiveMinutes = 300_000 - (Date.now() % 300_000);
    let intervalId: number | undefined;
    const timeoutId = window.setTimeout(() => {
      updateCurrentTime();
      intervalId = window.setInterval(updateCurrentTime, 300_000);
    }, millisecondsUntilNextFiveMinutes);
    return () => {
      window.clearTimeout(timeoutId);
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, []);

  function appointmentDate(appointment: AppointmentRecord) {
    const period = parsePostgresRange(appointment.service_period);
    return period ? dateKeyInTimezone(period.start, timezone) : "";
  }

  function serviceLabel(appointmentId: string) {
    return itemsByAppointment.get(appointmentId)?.join(" + ") || "Atendimento";
  }

  function appointmentsOn(dateKey: string) {
    return filteredAppointments.filter((appointment) => appointmentDate(appointment) === dateKey);
  }

  function closeCreate() {
    setNewOpen(false);
    setCustomerQuery("");
    setSelectedCustomerId("");
    setQuickCustomerOpen(false);
  }

  function navigate(amount: number) {
    setDate((current) => view === "month" ? shiftMonth(current, amount) : shiftDateKey(current, amount * (view === "week" ? 7 : 1)));
  }

  async function createAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const [type, id] = String(data.get("selection") ?? "").split(":");
    const startsAt = `${String(data.get("date") ?? "")}T${String(data.get("time") ?? "")}`;
    const saved = await runMutation(setMessage, async () => {
      if (blocked) throw new Error("A assinatura está bloqueada para novas reservas.");
      if (!type || !id) throw new Error("Escolha um serviço ou pacote.");
      if (!selectedCustomerId) throw new Error("Busque e selecione um cliente.");
      if (!isAlignedToSlot(startsAt, BUSINESS_SLOT_INTERVAL_MINUTES)) {
        throw new Error(`Escolha um horário em intervalos de ${BUSINESS_SLOT_INTERVAL_MINUTES} minutos.`);
      }
      await assertResult(await connectedClient().rpc("create_manual_appointment", {
        p_organization_id: props.organizationId,
        p_customer_id: selectedCustomerId,
        p_barber_id: String(data.get("barber_id")),
        p_starts_at: localDateTimeToIso(startsAt, timezone),
        p_selections: [{ type, id, quantity: 1 }],
        p_override_reason: String(data.get("override_reason") ?? "").trim() || null,
        p_notes: String(data.get("notes") ?? "").trim() || null,
      }));
    }, "Agendamento criado com saldo pendente para o balcão.");
    if (saved) {
      setDate(String(data.get("date")));
      setView("day");
      form.reset();
      closeCreate();
      router.refresh();
    }
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
      if (result.data) {
        const customer = result.data as Props["customers"][number];
        setCreatedCustomers((current) => [...current, customer]);
        setSelectedCustomerId(customer.id);
        setCustomerQuery(customer.full_name);
      }
    }, "Cliente criado e selecionado.");
    if (saved) {
      setQuickCustomerOpen(false);
      setQuickCustomerName("");
      setQuickCustomerPhone("");
    }
  }

  async function transition(appointment: AppointmentRecord, next: "IN_SERVICE" | "COMPLETED" | "NO_SHOW") {
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("transition_appointment", {
        p_appointment_id: appointment.id,
        p_expected_status: appointment.status,
        p_new_status: next,
        p_reason: `manager_${next.toLowerCase()}`,
      }));
    }, next === "IN_SERVICE" ? "Atendimento iniciado." : next === "COMPLETED" ? "Atendimento concluído; comissão lançada." : "Não compareceu registrado.");
    if (saved) {
      if (next === "COMPLETED" && appointment.payment_mode === "COUNTER") {
        const customer = customerById.get(appointment.customer_id);
        const barber = barberById.get(appointment.barber_id);
        const outstanding = financialById.get(appointment.id)?.outstanding_cents ?? appointment.total_cents_snapshot;
        if (outstanding > 0) {
          setReceiptTarget(buildAppointmentReceiptDraft({ appointmentId: appointment.id, customerId: appointment.customer_id, customerName: customer?.full_name ?? "Cliente", serviceDescription: serviceLabel(appointment.id), barberName: barber?.display_name ?? "Profissional", amountCents: outstanding, reservedAt: appointment.created_at, completedAt: new Date().toISOString() }));
        }
      }
      setSelected(null);
      router.refresh();
    }
  }

  async function cancel(appointment: AppointmentRecord) {
    const reason = window.prompt("Motivo do cancelamento:", "Cancelado pelo gestor");
    if (!reason) return;
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("cancel_appointment", { p_appointment_id: appointment.id, p_reason: reason, p_requested_by_customer: false }));
    }, "Agendamento cancelado. Reembolso, quando devido, foi encaminhado.");
    if (saved) { setSelected(null); router.refresh(); }
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
    if (saved) { setSelected(null); router.refresh(); }
  }

  async function confirmManuallyByWhatsApp(appointment: AppointmentRecord) {
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("confirm_appointment_manually_by_whatsapp", {
        p_appointment_id: appointment.id,
      }));
    }, "Confirmação manual registrada; mensagens para cliente e profissional foram enfileiradas.");
    if (saved) { setSelected(null); router.refresh(); }
  }

  async function reschedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rescheduling) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const startsAt = `${String(data.get("date") ?? "")}T${String(data.get("time") ?? "")}`;
    const saved = await runMutation(setMessage, async () => {
      if (blocked) throw new Error("A assinatura está bloqueada para reagendamentos.");
      if (!isAlignedToSlot(startsAt, BUSINESS_SLOT_INTERVAL_MINUTES)) {
        throw new Error(`Escolha um horário em intervalos de ${BUSINESS_SLOT_INTERVAL_MINUTES} minutos.`);
      }
      await assertResult(await connectedClient().rpc("reschedule_appointment", {
        p_appointment_id: rescheduling.id,
        p_new_barber_id: String(data.get("barber_id")),
        p_new_starts_at: localDateTimeToIso(startsAt, timezone),
        p_selections: null,
        p_override_reason: String(data.get("override_reason") ?? "").trim() || null,
      }));
    }, "Agendamento reagendado atomicamente.");
    if (saved) { setRescheduling(null); setSelected(null); setDate(String(data.get("date"))); setView("day"); router.refresh(); }
  }

  const selectedCustomerRecord = selected ? customerById.get(selected.customer_id) : null;
  const selectedBarberRecord = selected ? barberById.get(selected.barber_id) : null;
  const selectedFinancial = selected ? financialById.get(selected.id) : null;

  return <div className={styles.stack}>
    <div className={styles.agendaHeader}>
      <PageHeader title="Agenda" description="Organize equipe, horários e atendimentos em tempo real." />
      <button type="button" className={styles.agendaHelpLink} onClick={() => setAgendaHelpOpen(true)}>Como funciona a agenda</button>
    </div>
    {blocked && <ActionMessage tone="warning" message="Assinatura bloqueada: criar e reagendar estão desabilitados. As reservas existentes continuam operacionais." />}
    <ActionMessage message={message} />

    <div className={`agenda-toolbar ${styles.connectedToolbar}`}>
      <div className="agenda-toolbar__date">
        <button type="button" className="icon-button" aria-label="Período anterior" onClick={() => navigate(-1)}><ChevronLeft size={18} /></button>
        <button type="button" className="agenda-date-button" aria-label="Selecionar data" onClick={() => setDatePickerOpen((open) => !open)}><CalendarDays size={17} /><span><strong>{formatDate(date)}</strong><small>{date === todayKey ? "Hoje" : "Selecionar dia"}</small></span><ChevronDown size={15} /></button>
        <button type="button" className="icon-button" aria-label="Próximo período" onClick={() => navigate(1)}><ChevronRight size={18} /></button>
        <button type="button" className="button button--soft button--sm" onClick={() => setDate(todayKey)}>Hoje</button>
        {datePickerOpen && <div className="agenda-date-picker"><label htmlFor="connected-agenda-date">Selecionar data</label><input id="connected-agenda-date" aria-label="Selecionar data da agenda" type="date" value={date} onChange={(event) => { setDate(event.target.value); setDatePickerOpen(false); }} /></div>}
      </div>
      <div className={`agenda-toolbar__controls ${styles.connectedControls}`}>
        <label className="select-shell"><Filter size={16} /><select aria-label="Filtrar por profissional" value={barberFilter} onChange={(event) => setBarberFilter(event.target.value)}><option value="ALL">Todos</option>{props.barbers.map((barber) => <option key={barber.id} value={barber.id}>{barber.display_name}</option>)}</select><ChevronDown size={14} /></label>
        <label className="select-shell"><select aria-label="Filtrar por status" value={status} onChange={(event) => setStatus(event.target.value as AgendaStatusFilter)} >{agendaStatusFilters.map((item) => <option key={item} value={item}>{agendaStatusFilterLabels[item]}</option>)}</select><ChevronDown size={14} /></label>
        <div className="segmented-control" aria-label="Visualização da agenda">
          <button type="button" className={view === "day" ? "is-active" : ""} onClick={() => setView("day")}>Dia</button>
          <button type="button" className={view === "week" ? "is-active" : ""} onClick={() => setView("week")}>Semana</button>
          <button type="button" className={view === "month" ? "is-active" : ""} onClick={() => setView("month")}>Mês</button>
        </div>
        <button type="button" className="button button--dark" onClick={() => setNewOpen(true)} disabled={blocked}><CalendarPlus2 size={17} /> Novo agendamento</button>
      </div>
    </div>

    {view === "day" && <section className="agenda-day panel" aria-label="Agenda diária">
      <div className="agenda-day__head" style={{ gridTemplateColumns: `56px repeat(${Math.max(displayedBarbers.length, 1)}, minmax(220px, 1fr))` }}>
        <div className="agenda-day__time-label">Horário</div>
        {displayedBarbers.map((barber, index) => <div className="agenda-day__barber" key={barber.id}><Avatar initials={barber.display_name.slice(0, 2).toUpperCase()} tone={index % 3 === 0 ? "sage" : index % 3 === 1 ? "amber" : "blue"} size="sm" /><span><strong>{barber.display_name}</strong><small>{appointmentsOn(date).filter((appointment) => appointment.barber_id === barber.id).length} hoje</small></span><i /></div>)}
      </div>
      <div className="agenda-day__scroll" aria-label="Horários da agenda">
      <div className="agenda-day__grid" style={{ gridTemplateColumns: `56px repeat(${Math.max(displayedBarbers.length, 1)}, minmax(220px, 1fr))`, height: hours.length * 78 }}>
        {!appointmentsOn(date).length && <div className="agenda-day__empty">Nenhum agendamento para este dia.</div>}
        <div className="agenda-time-axis" style={{ gridTemplateRows: `repeat(${hours.length}, 78px)` }}>{hours.map((hour) => <span key={hour}>{hour}</span>)}</div>
        {displayedBarbers.map((barber, barberIndex) => <div className="agenda-column" style={{ gridTemplateRows: `repeat(${hours.length}, 78px)` }} key={barber.id}>
          {hours.map((hour) => <span className="agenda-gridline" key={hour} />)}
          {appointmentsOn(date).filter((appointment) => appointment.barber_id === barber.id).map((appointment, itemIndex) => {
            const geometry = appointmentGeometry(appointment.service_period, timezone);
            if (!geometry) return null;
            const displayStatus = appointmentDisplayStatus(appointment);
            return <button key={appointment.id} type="button" aria-label={`Abrir ${customerById.get(appointment.customer_id)?.full_name ?? "agendamento"}`} className={`agenda-event agenda-event--${(barberIndex + itemIndex) % 3} agenda-event--response-${displayStatus.tone}${geometry.height <= 39 ? " agenda-event--short" : ""}`} style={{ top: geometry.top, height: geometry.height }} onClick={() => setSelected(appointment)}><span className="agenda-event__time"><span className="sr-only">{geometry.startLabel} — {geometry.endLabel}</span><span aria-hidden="true">{geometry.startLabel}</span><span aria-hidden="true">{geometry.endLabel}</span></span><span className="agenda-event__details"><strong>{customerById.get(appointment.customer_id)?.full_name ?? "Cliente"}</strong><small>{serviceLabel(appointment.id)}</small><i>{displayStatus.label}</i></span></button>;
          })}
        </div>)}
        {nowLine && <div className="agenda-now-line" style={{ top: nowLine.top }} aria-label={`Hora atual: ${nowLine.label}`}><span>{nowLine.label}</span><i /></div>}
      </div>
      </div>
    </section>}

    {view === "week" && <section className="panel agenda-week" aria-label="Agenda semanal">
      <div className="agenda-week__head"><span>Horário</span>{weekDates.map((day) => <button type="button" key={day} className={`${styles.weekDay} ${day === todayKey ? styles.weekDayToday : ""}`} onClick={() => { setDate(day); setView("day"); }}><strong>{formatDate(day, { weekday: "short", day: "2-digit" })}</strong><small>{appointmentsOn(day).length} reservas</small></button>)}</div>
      <div className="agenda-week__body">{hours.map((hour) => <div className="agenda-week__row" key={hour}><time>{hour}</time>{weekDates.map((day, column) => <div className={styles.weekCell} key={day}>{appointmentsOn(day).filter((appointment) => appointmentGeometry(appointment.service_period, timezone)?.startLabel.startsWith(hour.slice(0, 2))).map((appointment) => <button type="button" key={appointment.id} className={`has-event tone-${column % 3}`} onClick={() => setSelected(appointment)}><strong>{appointmentGeometry(appointment.service_period, timezone)?.startLabel} · {customerById.get(appointment.customer_id)?.full_name ?? "Cliente"}</strong><small>{serviceLabel(appointment.id)}</small></button>)}</div>)}</div>)}</div>
    </section>}

    {view === "month" && <section className="panel agenda-month" aria-label="Agenda mensal">
      <div className="agenda-month__weekdays">{["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="agenda-month__grid">{month.map((cell) => {
        const appointments = appointmentsOn(cell.dateKey);
        return <button type="button" key={cell.dateKey} className={`${cell.outside ? "is-muted" : ""} ${cell.dateKey === todayKey ? "is-today" : ""}`} onClick={() => { setDate(cell.dateKey); setView("day"); }}><span>{cell.day}</span>{appointments.length > 0 && <><strong>{appointments.length} {appointments.length === 1 ? "reserva" : "reservas"}</strong><small>{formatCents(appointments.reduce((sum, appointment) => sum + appointment.total_cents_snapshot, 0))}</small></>}</button>;
      })}</div>
    </section>}

    {selected && <div className="modal-layer" role="presentation"><button className="modal-layer__backdrop" type="button" aria-label="Fechar detalhes" onClick={() => setSelected(null)} /><section className="form-modal appointment-detail" role="dialog" aria-modal="true" aria-label="Detalhes do agendamento">
      <div className="appointment-detail__head"><span><small>Agendamento {selected.id.slice(0, 8)}</small><strong>Detalhes do atendimento</strong></span><button type="button" className="icon-button" onClick={() => setSelected(null)} aria-label="Fechar"><X size={19} /></button></div>
      <div className="appointment-detail__body">
        <div className="appointment-detail__customer"><Avatar initials={(selectedCustomerRecord?.full_name ?? "CL").slice(0, 2).toUpperCase()} size="lg" tone="sage" /><span><strong>{selectedCustomerRecord?.full_name ?? "Cliente"}</strong><small>{selectedCustomerRecord?.phone_e164 ?? "Sem telefone"}</small></span></div>
        <StatusChip active={!['CANCELED', 'NO_SHOW', 'EXPIRED'].includes(selected.status)} label={appointmentDisplayStatus(selected).label} tone={appointmentDisplayStatus(selected).tone} />
        <div className="appointment-detail__info">
          <span><CalendarDays size={17} /><div><small>Data e horário</small><strong>{formatRange(selected.service_period, timezone)}</strong></div></span>
          <span><Scissors size={17} /><div><small>Serviço ou pacote</small><strong>{serviceLabel(selected.id)}</strong></div></span>
          <span><UserRound size={17} /><div><small>Profissional</small><strong>{selectedBarberRecord?.display_name ?? "Profissional"}</strong></div></span>
          <span><MapPin size={17} /><div><small>Origem</small><strong>{selected.source}</strong></div></span>
        </div>
        <div className="appointment-detail__payment"><div><span><CircleDollarSign size={17} /> Pagamento</span><small>{selectedFinancial?.financial_status === "UNPAID" ? "Pgto Pendente" : selectedFinancial?.financial_status ?? "Pgto Pendente"}</small></div><strong>{formatCents(selected.total_cents_snapshot)}</strong><span>Saldo: {formatCents(selectedFinancial?.outstanding_cents ?? selected.total_cents_snapshot)}</span></div>
        {selectedCustomerRecord?.phone_e164 && <div className="appointment-detail__contact"><a href={`https://web.whatsapp.com/send?phone=${selectedCustomerRecord.phone_e164.replace(/\D/g, "")}`} target="_blank" rel="noreferrer"><MessageCircle size={17} /> WhatsApp</a></div>}
      </div>
      <div className="appointment-detail__actions">
        {["HELD", "PENDING_PAYMENT"].includes(selected.status) && <button type="button" className="button button--soft" onClick={() => confirmWithoutPayment(selected)}>Confirmar sem pagamento</button>}
        {selected.status === "CONFIRMED" && !["CONFIRMED_BY_WHATSAPP", "CONFIRMED_MANUALLY"].includes(selected.whatsapp_response_status ?? "PENDING") && <button type="button" className="button button--soft" onClick={() => confirmManuallyByWhatsApp(selected)}>Confirmar manualmente</button>}
        {selected.status === "CONFIRMED" && <button type="button" className="button button--dark" onClick={() => transition(selected, "IN_SERVICE")}><Check size={17} /> Iniciar</button>}
        {selected.status === "IN_SERVICE" && <button type="button" className="button button--dark" onClick={() => transition(selected, "COMPLETED")}><Check size={17} /> Concluir</button>}
        {["HELD", "PENDING_PAYMENT", "CONFIRMED"].includes(selected.status) && <button type="button" className="button button--soft" disabled={blocked} onClick={() => setRescheduling(selected)}>Reagendar</button>}
        {selected.status === "CONFIRMED" && <button type="button" className="button button--soft" onClick={() => transition(selected, "NO_SHOW")}>Não compareceu</button>}
        {["HELD", "PENDING_PAYMENT", "CONFIRMED"].includes(selected.status) && <button type="button" className="button button--soft" onClick={() => cancel(selected)}>Cancelar</button>}
      </div>
    </section></div>}

    {newOpen && <div className="modal-layer" role="presentation"><button className="modal-layer__backdrop" type="button" aria-label="Fechar" onClick={closeCreate} /><form className="form-modal" role="dialog" aria-modal="true" aria-label="Novo agendamento" onSubmit={createAppointment}>
      <div className="form-modal__head"><span><small>Novo agendamento</small><strong>Reserve um horário</strong></span><button type="button" className="icon-button" onClick={closeCreate} aria-label="Fechar"><X size={19} /></button></div>
      <div className="form-modal__body">
        <label>Cliente<span className="input-shell"><UserRound size={17} /><input required value={selectedCustomer?.full_name ?? customerQuery} onChange={(event) => { setCustomerQuery(event.target.value); setSelectedCustomerId(""); }} placeholder="Buscar por nome ou telefone" /></span></label>
        {customerQuery.trim() && !selectedCustomerId && <div className="customer-search-results">{matchingCustomers.map((customer) => <button className="customer-search-result" key={customer.id} type="button" aria-label={`Selecionar ${customer.full_name}`} onClick={() => { setSelectedCustomerId(customer.id); setCustomerQuery(customer.full_name); }}><strong>{customer.full_name}</strong><small>{customer.phone_e164 ?? "Sem telefone"}</small></button>)}{matchingCustomers.length === 0 && <button className="customer-search-create" type="button" onClick={() => { setQuickCustomerName(customerQuery); setQuickCustomerOpen(true); }}>Cadastrar novo cliente</button>}</div>}
        {selectedCustomer && <p className="customer-search-selected"><Check size={15} /> {selectedCustomer.full_name} selecionado</p>}
        {quickCustomerOpen && <div className="customer-quick-create"><label>Nome do novo cliente<input aria-label="Nome do novo cliente" value={quickCustomerName} onChange={(event) => setQuickCustomerName(event.target.value)} /></label><label>Telefone<input value={quickCustomerPhone} onChange={(event) => setQuickCustomerPhone(event.target.value)} /></label><button className="button button--soft button--sm" type="button" onClick={createQuickCustomer}>Salvar cliente</button></div>}
        <div className="form-grid"><label>Serviço ou pacote<span className="select-input"><select name="selection" required defaultValue=""><option value="">Selecione</option><optgroup label="Serviços">{props.services.map((item) => <option key={item.id} value={`SERVICE:${item.id}`}>{item.name} · {formatCents(item.price_cents)}</option>)}</optgroup><optgroup label="Pacotes">{props.packages.map((item) => <option key={item.id} value={`PACKAGE:${item.id}`}>{item.name} · {formatCents(item.price_cents)}</option>)}</optgroup></select><ChevronDown size={15} /></span></label><label>Profissional<span className="select-input"><select name="barber_id" required defaultValue={barberFilter === "ALL" ? props.barbers[0]?.id : barberFilter}>{props.barbers.map((barber) => <option key={barber.id} value={barber.id}>{barber.display_name}</option>)}</select><ChevronDown size={15} /></span></label></div>
        <div className="form-grid"><label>Data<span className="input-shell"><CalendarDays size={17} /><input name="date" type="date" defaultValue={date} required /></span></label><label>Horário<span className="input-shell"><Clock3 size={17} /><input name="time" type="time" defaultValue="09:00" step={BUSINESS_SLOT_INTERVAL_MINUTES * 60} required /></span></label></div>
        <label>Observação <small>opcional</small><textarea name="notes" placeholder="Preferências e observações..." rows={3} /></label>
        <label>Motivo fora da escala <small>somente quando necessário</small><span className="input-shell"><input name="override_reason" placeholder="Explique por que este horário será liberado" /></span></label>
        <label className="check-row"><input type="checkbox" defaultChecked required /><span><strong>Confirmar sem pagamento</strong><small>O saldo ficará pendente para o balcão.</small></span></label>
      </div>
      <div className="form-modal__footer"><button type="button" className="button button--ghost" onClick={closeCreate}>Cancelar</button><button type="submit" className="button button--dark"><CalendarPlus2 size={17} /> Criar agendamento</button></div>
    </form></div>}

    {rescheduling && <div className="modal-layer" role="presentation"><button className="modal-layer__backdrop" type="button" aria-label="Fechar reagendamento" onClick={() => setRescheduling(null)} /><form className="form-modal" role="dialog" aria-modal="true" aria-label="Reagendar" onSubmit={reschedule}>
      <div className="form-modal__head"><span><small>Reagendamento</small><strong>Escolha o novo horário</strong></span><button type="button" className="icon-button" onClick={() => setRescheduling(null)} aria-label="Fechar"><X size={19} /></button></div>
      <div className="form-modal__body"><div className="form-grid"><label>Profissional<span className="select-input"><select name="barber_id" defaultValue={rescheduling.barber_id}>{props.barbers.map((barber) => <option key={barber.id} value={barber.id}>{barber.display_name}</option>)}</select><ChevronDown size={15} /></span></label><label>Data<span className="input-shell"><CalendarDays size={17} /><input name="date" type="date" defaultValue={appointmentDate(rescheduling)} required /></span></label></div><div className="form-grid"><label>Horário<span className="input-shell"><Clock3 size={17} /><input name="time" type="time" defaultValue={appointmentGeometry(rescheduling.service_period, timezone)?.startLabel} step={BUSINESS_SLOT_INTERVAL_MINUTES * 60} required /></span></label><label>Motivo fora da escala<input name="override_reason" /></label></div></div>
      <div className="form-modal__footer"><button type="button" className="button button--ghost" onClick={() => setRescheduling(null)}>Cancelar</button><button type="submit" className="button button--dark">Proteger novo slot</button></div>
    </form></div>}
    {agendaHelpOpen && <div className="modal-layer" role="presentation"><button className="modal-layer__backdrop" type="button" aria-label="Fechar explicação da agenda" onClick={() => setAgendaHelpOpen(false)} /><section className={`form-modal ${styles.agendaHelpModal}`} role="dialog" aria-modal="true" aria-label="Como funciona a agenda">
      <div className="form-modal__head"><span><strong>Como funciona a agenda</strong></span><button type="button" className="icon-button" onClick={() => setAgendaHelpOpen(false)} aria-label="Fechar"><X size={19} /></button></div>
      <div className="form-modal__body">
        <p className={styles.agendaHelpIntro}>A agenda protege tempo real de cada profissional. Escolha cliente, serviço ou pacote, profissional, data e horário.</p>
        <ol className={styles.agendaHelpSteps}>
          <li><strong>Serviço e pacote definem duração.</strong><span>O tempo cadastrado reserva período na agenda. Pacote usa própria duração; se não houver, soma serviços incluídos.</span></li>
          <li><strong>Horários seguem intervalos da agenda.</strong><span>Para manter grade organizada, reserva ocupa próximo intervalo completo. Exemplo: 80 minutos em grade de 15 ocupa 90 minutos.</span></li>
          <li><strong>Escala e conflitos são conferidos.</strong><span>Sistema verifica disponibilidade do profissional e impede duas reservas no mesmo período.</span></li>
          <li><strong>Atendimento acompanha rotina.</strong><span>Reserva confirmada passa por iniciar e concluir. Depois, recebimento fica disponível no Financeiro quando necessário.</span></li>
        </ol>
      </div>
      <div className="form-modal__footer"><button type="button" className="button button--dark" onClick={() => setAgendaHelpOpen(false)}>Entendi</button></div>
    </section></div>}
    {receiptTarget && <AppointmentReceiptDialog receipt={receiptTarget} onClose={() => setReceiptTarget(null)} onSaved={() => { setReceiptTarget(null); router.refresh(); }} setMessage={setMessage} />}
  </div>;
}
