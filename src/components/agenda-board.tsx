"use client";

import { FormEvent, useMemo, useState } from "react";
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
  MoreHorizontal,
  Phone,
  Scissors,
  UserRound,
  X,
} from "lucide-react";
import { appointments, barbers, customers, formatMoney, type Appointment } from "@/data/demo";
import { Avatar, StatusChip } from "@/components/ui";
import { useManagerBillingBlocked } from "@/components/manager-shell";

const hours = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"];
const monthDays = Array.from({ length: 35 }, (_, index) => ({
  day: index < 2 ? 30 + index : index - 1,
  muted: index < 2 || index > 32,
  count: index === 3 ? 12 : [5, 7, 10, 14, 18, 21, 24, 26, 29].includes(index) ? (index % 5) + 3 : 0,
}));

const initialDate = "2026-08-04";
const serviceDurations: Record<string, number> = {
  "Corte clássico": 45,
  "Corte degradê": 45,
  "Barba premium": 45,
  "Experiência completa": 120,
};

function shiftDate(dateKey: string, amount: number) {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return date.toISOString().slice(0, 10);
}

function formatDate(dateKey: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${dateKey}T12:00:00`));
}

function addMinutes(time: string, minutes: number) {
  const [hour, minute] = time.split(":").map(Number);
  const totalMinutes = hour * 60 + minute + minutes;
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

export function AgendaBoard() {
  const billingBlocked = useManagerBillingBlocked();
  const [view, setView] = useState<"day" | "week" | "month">("day");
  const [selectedBarber, setSelectedBarber] = useState("Todos");
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [demoCustomers, setDemoCustomers] = useState(customers);
  const [demoAppointments, setDemoAppointments] = useState(appointments);
  const [customerQuery, setCustomerQuery] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [toast, setToast] = useState("");

  const isToday = selectedDate === initialDate;
  const customerMatches = useMemo(() => {
    const query = customerQuery.trim().toLocaleLowerCase("pt-BR");
    if (!query) return [];
    return demoCustomers.filter((customer) => `${customer.name} ${customer.phone}`.toLocaleLowerCase("pt-BR").includes(query));
  }, [customerQuery, demoCustomers]);
  const selectedCustomer = demoCustomers.find((customer) => customer.id === selectedCustomerId) ?? null;
  const visibleAppointments = useMemo(
    () => demoAppointments.filter((item) => item.date === selectedDate && (selectedBarber === "Todos" || item.barber.startsWith(selectedBarber))),
    [demoAppointments, selectedBarber, selectedDate],
  );

  function createAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCustomerId) {
      setToast("Selecione um cliente antes de criar o agendamento.");
      window.setTimeout(() => setToast(""), 3200);
      return;
    }
    const formData = new FormData(event.currentTarget);
    const date = String(formData.get("date") ?? "");
    const time = String(formData.get("time") ?? "");
    const service = String(formData.get("service") ?? "");
    const barberName = String(formData.get("barber") ?? "");
    const barber = barbers.find((item) => item.name === barberName);
    if (!date || !time || !service || !barber || !selectedCustomer) return;
    setDemoAppointments((current) => [...current, {
      id: `AG-DEMO-${Date.now()}`,
      date,
      time,
      endTime: addMinutes(time, serviceDurations[service] ?? 45),
      customer: selectedCustomer.name,
      initials: selectedCustomer.initials,
      service,
      barber: barber.name,
      barberInitials: barber.initials,
      status: "CONFIRMED",
      valueCents: 0,
      paidCents: 0,
      phone: selectedCustomer.phone,
      source: "Balcão",
    }]);
    setSelectedDate(date);
    setCreateOpen(false);
    setToast("Agendamento demo criado.");
    window.setTimeout(() => setToast(""), 3200);
  }

  function createCustomer() {
    const name = newCustomerName.trim();
    if (!name) return;
    const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
    const id = `customer-${name.toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
    setDemoCustomers((current) => [...current, { id, name, initials, phone: "", email: "", visits: 0, totalCents: 0, lastVisit: "Ainda não visitou", tags: ["Novo"] }]);
    setSelectedCustomerId(id);
    setCustomerQuery(name);
    setNewCustomerName("");
    setNewCustomerOpen(false);
  }

  return (
    <>
      <div className="agenda-toolbar">
        <div className="agenda-toolbar__date">
          <button type="button" className="icon-button" aria-label="Dia anterior" onClick={() => setSelectedDate((date) => shiftDate(date, -1))}><ChevronLeft size={18} /></button>
          <button type="button" className="agenda-date-button" aria-label="Selecionar data" onClick={() => setDatePickerOpen((open) => !open)}><CalendarDays size={17} /><span><strong>{formatDate(selectedDate)}</strong><small>{isToday ? "Hoje" : "Selecionar dia"}</small></span><ChevronDown size={15} /></button>
          <button type="button" className="icon-button" aria-label="Próximo dia" onClick={() => setSelectedDate((date) => shiftDate(date, 1))}><ChevronRight size={18} /></button>
          <button type="button" className="button button--soft button--sm" onClick={() => setSelectedDate(initialDate)}>Hoje</button>
          {datePickerOpen && <div className="agenda-date-picker"><label htmlFor="agenda-date-picker-input">Selecionar data</label><input id="agenda-date-picker-input" aria-label="Selecionar data" type="date" value={selectedDate} onChange={(event) => { setSelectedDate(event.target.value); setDatePickerOpen(false); }} /></div>}
        </div>
        <div className="agenda-toolbar__controls">
          <label className="select-shell"><Filter size={16} /><select aria-label="Filtrar por profissional" value={selectedBarber} onChange={(event) => setSelectedBarber(event.target.value)}><option>Todos</option>{barbers.map((barber) => <option key={barber.id}>{barber.name.split(" ")[0]}</option>)}</select><ChevronDown size={14} /></label>
          <div className="segmented-control" aria-label="Visualização da agenda">
            <button type="button" className={view === "day" ? "is-active" : ""} onClick={() => setView("day")}>Dia</button>
            <button type="button" className={view === "week" ? "is-active" : ""} onClick={() => setView("week")}>Semana</button>
            <button type="button" className={view === "month" ? "is-active" : ""} onClick={() => setView("month")}>Mês</button>
          </div>
          <button type="button" className="button button--dark" onClick={() => setCreateOpen(true)} disabled={billingBlocked} title={billingBlocked ? "Regularize o plano para criar reservas" : undefined}><CalendarPlus2 size={17} /> Novo agendamento</button>
        </div>
      </div>

      {view === "day" && (
        <section className="agenda-day panel">
          <div className="agenda-day__head">
            <div className="agenda-day__time-label">Horário</div>
            {barbers.map((barber) => (
              <div className="agenda-day__barber" key={barber.id}><Avatar initials={barber.initials} tone={barber.color as "sage" | "amber" | "blue"} size="sm" /><span><strong>{barber.name}</strong><small>{barber.appointmentsToday} hoje</small></span><i /></div>
            ))}
          </div>
          <div className="agenda-day__grid">
            {visibleAppointments.length === 0 && <div className="agenda-day__empty">Nenhum agendamento para este dia.</div>}
            <div className="agenda-time-axis">{hours.map((hour) => <span key={hour}>{hour}</span>)}</div>
            {barbers.map((barber, barberIndex) => (
              <div className="agenda-column" key={barber.id}>
                {hours.map((hour) => <span className="agenda-gridline" key={hour} />)}
                {visibleAppointments.filter((item) => item.barber === barber.name).map((appointment, itemIndex) => {
                  const top = 8 + (parseInt(appointment.time.split(":")[0], 10) - 8) * 78 + (parseInt(appointment.time.split(":")[1], 10) / 60) * 78;
                  const duration = (parseInt(appointment.endTime.split(":")[0], 10) * 60 + parseInt(appointment.endTime.split(":")[1], 10)) - (parseInt(appointment.time.split(":")[0], 10) * 60 + parseInt(appointment.time.split(":")[1], 10));
                  return (
                    <button key={appointment.id} type="button" className={`agenda-event agenda-event--${(barberIndex + itemIndex) % 3}`} style={{ top, height: Math.max(58, duration * 1.3 - 7) }} onClick={() => setSelected(appointment)}>
                      <span className="agenda-event__time"><span className="sr-only">{appointment.time} — {appointment.endTime}</span><span aria-hidden="true">{appointment.time}</span><span aria-hidden="true">{appointment.endTime}</span></span>
                      <span className="agenda-event__details">
                        <strong>{appointment.customer}</strong>
                        <small>{appointment.service}</small>
                        <i>{appointment.status === "IN_SERVICE" ? "Em atendimento" : appointment.status === "PENDING_PAYMENT" ? "Pendente" : "Confirmado"}</i>
                      </span>
                    </button>
                  );
                })}
                <button type="button" className="agenda-empty-slot" style={{ top: `${605 + barberIndex * 34}px` }} onClick={() => setCreateOpen(true)} disabled={billingBlocked}><span>+</span> Horário livre</button>
              </div>
            ))}
            <div className="agenda-now-line" style={{ top: 8 + (10 - 8) * 78 + (12 / 60) * 78 }}><span>10:12</span><i /></div>
          </div>
        </section>
      )}

      {view === "week" && (
        <section className="panel agenda-week">
          <div className="agenda-week__head"><span>Horário</span>{["Seg 03", "Ter 04", "Qua 05", "Qui 06", "Sex 07", "Sáb 08"].map((day, index) => <strong key={day} className={index === 1 ? "is-today" : ""}>{day}<small>{[8, 12, 10, 14, 16, 18][index]} reservas</small></strong>)}</div>
          <div className="agenda-week__body">
            {hours.slice(0, 10).map((hour, row) => (
              <div className="agenda-week__row" key={hour}><time>{hour}</time>{Array.from({ length: 6 }, (_, column) => <button type="button" key={column} className={(row + column) % 3 === 0 ? `has-event tone-${column % 3}` : ""}>{(row + column) % 3 === 0 && <><strong>{["Rafael M.", "Caio N.", "Bruno S."][column % 3]}</strong><small>{["Corte", "Combo", "Barba"][column % 3]}</small></>}</button>)}</div>
            ))}
          </div>
        </section>
      )}

      {view === "month" && (
        <section className="panel agenda-month">
          <div className="agenda-month__weekdays">{["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((day) => <span key={day}>{day}</span>)}</div>
          <div className="agenda-month__grid">{monthDays.map((item, index) => <button type="button" key={index} className={`${item.muted ? "is-muted" : ""} ${item.day === 4 && !item.muted ? "is-today" : ""}`}><span>{item.day}</span>{item.count > 0 && <><strong>{item.count} reservas</strong><small>{formatMoney(item.count * 6300)}</small></>}</button>)}</div>
        </section>
      )}

      {selected && (
        <>
          <button className="mobile-overlay mobile-overlay--detail" type="button" aria-label="Fechar detalhes" onClick={() => setSelected(null)} />
          <aside className="appointment-detail" aria-label="Detalhes do agendamento">
            <div className="appointment-detail__head"><span><small>Agendamento {selected.id}</small><strong>Detalhes do atendimento</strong></span><button type="button" className="icon-button" onClick={() => setSelected(null)} aria-label="Fechar"><X size={19} /></button></div>
            <div className="appointment-detail__customer"><Avatar initials={selected.initials} size="lg" tone="sage" /><span><strong>{selected.customer}</strong><small>Cliente desde 2025 · 11 visitas</small></span></div>
            <StatusChip status={selected.status} />
            <div className="appointment-detail__info">
              <span><CalendarDays size={17} /><div><small>Data e horário</small><strong>Terça, 4 ago · {selected.time} – {selected.endTime}</strong></div></span>
              <span><Scissors size={17} /><div><small>Serviço</small><strong>{selected.service}</strong></div></span>
              <span><UserRound size={17} /><div><small>Profissional</small><strong>{selected.barber}</strong></div></span>
              <span><MapPin size={17} /><div><small>Origem</small><strong>{selected.source}</strong></div></span>
            </div>
            <div className="appointment-detail__payment"><div><span><CircleDollarSign size={17} /> Pagamento</span><small>{selected.paidCents === selected.valueCents ? "Quitado" : `${formatMoney(selected.valueCents - selected.paidCents)} no balcão`}</small></div><strong>{formatMoney(selected.valueCents)}</strong><span>Pago agora: {formatMoney(selected.paidCents)}</span></div>
            <div className="appointment-detail__contact"><a href={`tel:${selected.phone}`}><Phone size={17} /> Ligar</a><button type="button"><MessageCircle size={17} /> WhatsApp</button></div>
            <div className="appointment-detail__actions"><button type="button" className="button button--soft"><MoreHorizontal size={17} /> Mais ações</button><button type="button" className="button button--dark"><Check size={17} /> Iniciar atendimento</button></div>
          </aside>
        </>
      )}

      {createOpen && (
        <div className="modal-layer" role="presentation">
          <button className="modal-layer__backdrop" type="button" aria-label="Fechar" onClick={() => setCreateOpen(false)} />
          <form className="form-modal" onSubmit={createAppointment}>
            <div className="form-modal__head"><span><small>Novo agendamento</small><strong>Reserve um horário</strong></span><button type="button" className="icon-button" onClick={() => setCreateOpen(false)} aria-label="Fechar"><X size={19} /></button></div>
            <div className="form-modal__body">
              <label>Cliente<span className="input-shell"><UserRound size={17} /><input required value={selectedCustomer ? selectedCustomer.name : customerQuery} onChange={(event) => { setCustomerQuery(event.target.value); setSelectedCustomerId(null); }} placeholder="Buscar por nome ou telefone" /></span></label>
              {customerQuery.trim() && !selectedCustomer && <div className="customer-search-results">
                {customerMatches.map((customer) => <button className="customer-search-result" key={customer.id} type="button" aria-label={`Selecionar ${customer.name}`} onClick={() => { setSelectedCustomerId(customer.id); setCustomerQuery(customer.name); }}><strong>{customer.name}</strong><small>{customer.phone || "Sem telefone"}</small></button>)}
                {customerMatches.length === 0 && <button className="customer-search-create" type="button" onClick={() => { setNewCustomerName(customerQuery); setNewCustomerOpen(true); }}>Cadastrar novo cliente</button>}
              </div>}
              {selectedCustomer && <p className="customer-search-selected"><Check size={15} /> {selectedCustomer.name} selecionado</p>}
              {newCustomerOpen && <div className="customer-quick-create"><label>Nome do novo cliente<input value={newCustomerName} onChange={(event) => setNewCustomerName(event.target.value)} autoFocus /></label><button className="button button--soft button--sm" type="button" onClick={createCustomer}>Salvar cliente</button></div>}
              <div className="form-grid"><label>Serviço<span className="select-input"><select name="service" defaultValue="Corte clássico"><option>Corte clássico</option><option>Corte degradê</option><option>Barba premium</option><option>Experiência completa</option></select><ChevronDown size={15} /></span></label><label>Profissional<span className="select-input"><select name="barber" defaultValue="Diego Alves">{barbers.map((barber) => <option key={barber.id}>{barber.name}</option>)}</select><ChevronDown size={15} /></span></label></div>
              <div className="form-grid"><label>Data<span className="input-shell"><CalendarDays size={17} /><input name="date" type="date" defaultValue={selectedDate} required /></span></label><label>Horário<span className="input-shell"><Clock3 size={17} /><input name="time" type="time" defaultValue="16:30" step="900" required /></span></label></div>
              <label>Observação <small>opcional</small><textarea placeholder="Preferências, observações ou motivo para override..." rows={3} /></label>
              <label className="check-row"><input type="checkbox" /><span><strong>Confirmar sem pagamento</strong><small>O saldo ficará pendente para o balcão.</small></span></label>
            </div>
            <div className="form-modal__footer"><button type="button" className="button button--ghost" onClick={() => setCreateOpen(false)}>Cancelar</button><button type="submit" className="button button--dark"><CalendarPlus2 size={17} /> Criar agendamento</button></div>
          </form>
        </div>
      )}

      {toast && <div className="toast-message"><Check size={17} /><span>{toast}</span></div>}
    </>
  );
}
