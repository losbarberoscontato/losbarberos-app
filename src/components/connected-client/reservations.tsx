"use client";

import { AlertTriangle, CalendarDays, Check, Clock3, LoaderCircle, RefreshCw, RotateCcw, Scissors, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  cancelAppointment,
  createMercadoPagoCheckout,
  getAvailableSlots,
  getMyAppointments,
  rescheduleAppointment,
  toClientError,
} from "@/components/connected-client/api";
import { useConnectedClient } from "@/components/connected-client/context";
import {
  barberSupportsServices,
  bookingSelection,
  canCustomerReschedule,
  catalogChoices,
  dateOptions,
  formatInstant,
  formatLocalDate,
  formatMoney,
  formatSlotTime,
  parsePostgresRange,
  selectionsFromAppointmentItems,
  serviceIdsForChoice,
} from "@/components/connected-client/format";
import { AuthPrompt, ConnectedClientGate } from "@/components/connected-client/state";
import type { AvailableSlot, CustomerAppointment } from "@/components/connected-client/types";
import styles from "@/components/connected-client/connected-client.module.css";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

const statusLabels: Record<CustomerAppointment["status"], string> = {
  HELD: "Horário protegido",
  PENDING_PAYMENT: "Pagamento pendente",
  CONFIRMED: "Confirmado",
  IN_SERVICE: "Em atendimento",
  COMPLETED: "Concluído",
  CANCELED: "Cancelado",
  NO_SHOW: "Não compareceu",
  EXPIRED: "Expirado",
};

function appointmentStatusLabel(appointment: CustomerAppointment): string {
  if (appointment.status === "CANCELED" && appointment.whatsapp_response_status === "CANCELED_BY_WHATSAPP") return "Cancelado";
  if (appointment.status === "CONFIRMED") {
    if (appointment.whatsapp_response_status === "CONFIRMED_MANUALLY") return "Confirmado Manualmente";
    if (appointment.whatsapp_response_status === "CONFIRMED_BY_WHATSAPP") return "Confirmado";
    return "Agendado";
  }
  return statusLabels[appointment.status];
}

export function ConnectedReservations() {
  return <ConnectedClientGate><ReservationsContent /></ConnectedClientGate>;
}

function ReservationsContent() {
  const { context, slug, user, customer, authLoading } = useConnectedClient();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [appointments, setAppointments] = useState<CustomerAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loadedAt] = useState(() => Date.now());
  const [cancelTarget, setCancelTarget] = useState<CustomerAppointment | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [rescheduleTarget, setRescheduleTarget] = useState<CustomerAppointment | null>(null);
  const [barberId, setBarberId] = useState("");
  const [localDate, setLocalDate] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [rescheduleChoiceId, setRescheduleChoiceId] = useState("");
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [paymentBusyId, setPaymentBusyId] = useState("");
  const [modalError, setModalError] = useState("");
  const rescheduleChoice = useMemo(
    () => context ? catalogChoices(context).find((choice) => choice.id === rescheduleChoiceId) ?? null : null,
    [context, rescheduleChoiceId],
  );
  const requiredServiceIds = useMemo(() => {
    if (!context || !rescheduleTarget) return [];
    if (rescheduleChoice) return serviceIdsForChoice(context, rescheduleChoice);
    return [...new Set(rescheduleTarget.items.map((item) => item.service_id))];
  }, [context, rescheduleChoice, rescheduleTarget]);
  const compatibleBarbers = useMemo(
    () => context?.barbers.filter((barber) => barberSupportsServices(requiredServiceIds, barber.service_ids)) ?? [],
    [context, requiredServiceIds],
  );

  useEffect(() => {
    if (barberId && !compatibleBarbers.some((barber) => barber.id === barberId)) {
      queueMicrotask(() => setBarberId(""));
    }
  }, [barberId, compatibleBarbers]);

  const load = useCallback(async () => {
    if (!supabase || !context || !customer) {
      setAppointments([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      setAppointments(await getMyAppointments(supabase, context.organization.id, customer.id));
    } catch (cause: unknown) {
      setError(toClientError(cause, "Não foi possível carregar reservas."));
    } finally {
      setLoading(false);
    }
  }, [context, customer, supabase]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void load(); });
    return () => { active = false; };
  }, [load]);
  useEffect(() => {
    queueMicrotask(() => {
      const payment = new URLSearchParams(window.location.search).get("payment");
      if (payment === "approved") setNotice("Pagamento retornou como aprovado. Webhook assinado ainda confirma reserva.");
      if (payment === "pending") setNotice("Pagamento está pendente. Reserva atualiza após webhook do Mercado Pago.");
      if (payment === "failed") setNotice("Pagamento não concluiu. Hold expira automaticamente se não houver captura.");
    });
  }, []);

  useEffect(() => {
    if (!supabase || !context || !slug || !rescheduleTarget || !barberId || !localDate) {
      queueMicrotask(() => setSlots([]));
      return;
    }
    const selections = rescheduleChoice ? bookingSelection(rescheduleChoice) : selectionsFromAppointmentItems(rescheduleTarget.items);
    if (!selections.length) {
      queueMicrotask(() => setModalError("Itens da reserva não permitem consulta de novos horários."));
      return;
    }
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setSlotsLoading(true);
      setModalError("");
      setStartsAt("");
    });
    void getAvailableSlots(supabase, {
      organizationSlug: slug,
      barberId,
      localDate,
      selections,
    }).then((result) => {
      if (active) setSlots(result?.slots ?? []);
    }).catch((cause: unknown) => {
      if (active) setModalError(toClientError(cause, "Não foi possível consultar agenda."));
    }).finally(() => {
      if (active) setSlotsLoading(false);
    });
    return () => { active = false; };
  }, [barberId, context, localDate, rescheduleChoice, rescheduleTarget, slug, supabase]);

  if (!context || !slug) return null;
  const tenantSlug = slug;
  const tenantContext = context;
  if (authLoading) return <div className={styles.state} role="status"><LoaderCircle className={styles.spin} /> Validando sessão…</div>;
  if (!user) return <AuthPrompt description="Entre para ver somente reservas vinculadas à sua identidade." />;
  if (!customer && !loading) {
    return <section className={styles.emptyPage}><CalendarDays size={30} /><h1>Ainda sem perfil nesta barbearia</h1><p>Perfil nasce quando primeira reserva é confirmada.</p><Link className={styles.primaryButton} href={`/cliente/agendar?barbearia=${encodeURIComponent(slug)}`}>Agendar horário</Link></section>;
  }

  const upcoming = appointments.filter((appointment) => {
    const { startsAt: start } = parsePostgresRange(appointment.service_period);
    return new Date(start).getTime() >= loadedAt && ["HELD", "PENDING_PAYMENT", "CONFIRMED", "IN_SERVICE"].includes(appointment.status);
  }).sort((a, b) => new Date(parsePostgresRange(a.service_period).startsAt).getTime() - new Date(parsePostgresRange(b.service_period).startsAt).getTime());
  const history = appointments.filter((appointment) => !upcoming.some((item) => item.id === appointment.id));
  const timezone = context.organization.timezone;
  const acceptingBookings = context.organization.accepting_bookings;

  async function performCancel() {
    if (!supabase || !cancelTarget) return;
    setMutationBusy(true);
    setModalError("");
    try {
      const result = await cancelAppointment(supabase, cancelTarget.id, cancelReason || "customer_requested");
      setNotice(result.refund_amount_cents > 0
        ? `Reserva cancelada. Reembolso de ${formatMoney(result.refund_amount_cents, cancelTarget.currency)} entrou na fila.`
        : "Reserva cancelada. Nenhum valor reembolsável calculado.");
      setCancelTarget(null);
      setCancelReason("");
      await load();
    } catch (cause: unknown) {
      setModalError(toClientError(cause, "Não foi possível cancelar reserva."));
    } finally {
      setMutationBusy(false);
    }
  }

  function openReschedule(appointment: CustomerAppointment) {
    const { startsAt: currentStart } = parsePostgresRange(appointment.service_period);
    setRescheduleTarget(appointment);
    setBarberId(appointment.barber_id);
    setLocalDate(dateOptions(timezone)[0]);
    setStartsAt("");
    setRescheduleChoiceId("");
    setModalError("");
    if (!canCustomerReschedule(appointment.status, currentStart, appointment.cancellation_lead_minutes_snapshot, acceptingBookings)) {
      setModalError("Reserva fora do prazo ou barbearia pausou novos horários.");
    }
  }

  async function performReschedule() {
    if (!supabase || !rescheduleTarget || !startsAt || !barberId) return;
    setMutationBusy(true);
    setModalError("");
    try {
      const replacement = catalogChoices(tenantContext).find((choice) => choice.id === rescheduleChoiceId);
      await rescheduleAppointment(supabase, {
        appointmentId: rescheduleTarget.id,
        barberId,
        startsAt,
        selections: replacement ? bookingSelection(replacement) : null,
      });
      setNotice(replacement
        ? "Reserva reagendada. Novo item usou catálogo atual; diferença financeira ficou registrada."
        : "Reserva reagendada. Preços dos itens preservados; novo slot confirmado atomicamente.");
      setRescheduleTarget(null);
      await load();
    } catch (cause: unknown) {
      setModalError(toClientError(cause, "Não foi possível reagendar. Reserva original continua intacta."));
    } finally {
      setMutationBusy(false);
    }
  }

  async function resumePayment(appointment: CustomerAppointment) {
    if (!supabase || !appointment.pending_payment_order_id) return;
    setPaymentBusyId(appointment.id);
    setError("");
    try {
      const checkoutUrl = await createMercadoPagoCheckout(
        supabase,
        appointment.pending_payment_order_id,
        `mp-resume:${crypto.randomUUID()}`,
      );
      window.localStorage.setItem("los-barberos:client-tenant", tenantSlug);
      window.location.assign(checkoutUrl);
    } catch (cause: unknown) {
      setError(toClientError(cause, "Não foi possível retomar pagamento."));
    } finally {
      setPaymentBusyId("");
    }
  }

  return (
    <div className={styles.reservations}>
      <header className={styles.pageHeading}><span>Sua agenda · {context.organization.name}</span><h1>Minhas reservas</h1><p>Status operacional e financeiro separados. Dados vêm do tenant autenticado.</p></header>
      {notice && <div className={styles.notice} role="status"><Check size={17} /><span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="Fechar aviso"><X size={15} /></button></div>}
      {error && <div className={styles.errorBox} role="alert"><strong>Falha ao carregar</strong><span>{error}</span><button type="button" onClick={() => void load()}><RefreshCw size={15} /> Tentar novamente</button></div>}
      {loading ? <div className={styles.state} role="status"><LoaderCircle className={styles.spin} /> Carregando reservas…</div> : (
        <>
          <section className={styles.reservationSection}>
            <div className={styles.sectionTitle}><CalendarDays /><div><h2>Próximas</h2><p>{upcoming.length} compromisso(s)</p></div></div>
            {!upcoming.length ? <div className={styles.empty}><p>Nenhuma reserva futura.</p><Link href={`/cliente/agendar?barbearia=${encodeURIComponent(slug)}`} className={styles.primaryButton}>Agendar horário</Link></div> : <div className={styles.reservationList}>{upcoming.map((appointment) => <ReservationCard key={appointment.id} appointment={appointment} timezone={timezone} barberName={context.barbers.find((item) => item.id === appointment.barber_id)?.name ?? "Profissional"} onCancel={() => { setCancelTarget(appointment); setModalError(""); }} onReschedule={() => openReschedule(appointment)} onResumePayment={() => void resumePayment(appointment)} paymentBusy={paymentBusyId === appointment.id} acceptingBookings={context.organization.accepting_bookings} />)}</div>}
          </section>
          <section className={styles.reservationSection}>
            <div className={styles.sectionTitle}><Scissors /><div><h2>Histórico</h2><p>Atendimentos e reservas encerradas</p></div></div>
            {!history.length ? <p className={styles.empty}>Histórico vazio.</p> : <div className={styles.history}>{history.map((appointment) => {
              const { startsAt: start } = parsePostgresRange(appointment.service_period);
              return <article key={appointment.id}><span>{formatInstant(start, timezone, { dateStyle: "medium", timeStyle: undefined })}</span><div><strong>{appointment.items.map((item) => item.service_name_snapshot).join(" + ") || "Reserva"}</strong><small>{context.barbers.find((item) => item.id === appointment.barber_id)?.name ?? "Profissional"}</small></div><b data-status={appointment.status}>{appointmentStatusLabel(appointment)}</b><em>{formatMoney(appointment.total_cents_snapshot, appointment.currency)}</em></article>;
            })}</div>}
          </section>
        </>
      )}

      {cancelTarget && <div className={styles.modalLayer} role="presentation"><button type="button" className={styles.backdrop} onClick={() => setCancelTarget(null)} aria-label="Fechar cancelamento" /><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="cancel-title"><button type="button" className={styles.modalClose} onClick={() => setCancelTarget(null)} aria-label="Fechar"><X /></button><AlertTriangle className={styles.warning} /><h2 id="cancel-title">Cancelar reserva?</h2><p>Política congelada decide retenção e reembolso no banco. Operação não pode ser desfeita.</p><label>Motivo <small>opcional</small><select value={cancelReason} onChange={(event) => setCancelReason(event.target.value)}><option value="">Selecione</option><option value="personal_unforeseen">Imprevisto pessoal</option><option value="need_another_time">Preciso de outro horário</option><option value="other">Outro</option></select></label>{modalError && <p className={styles.error} role="alert">{modalError}</p>}<footer><button type="button" className={styles.secondaryButton} onClick={() => setCancelTarget(null)}>Manter reserva</button><button type="button" className={styles.dangerButton} disabled={mutationBusy} onClick={() => void performCancel()}>{mutationBusy ? "Cancelando…" : "Confirmar cancelamento"}</button></footer></section></div>}

      {rescheduleTarget && <div className={styles.modalLayer} role="presentation"><button type="button" className={styles.backdrop} onClick={() => setRescheduleTarget(null)} aria-label="Fechar reagendamento" /><section className={`${styles.modal} ${styles.modalWide}`} role="dialog" aria-modal="true" aria-labelledby="reschedule-title"><button type="button" className={styles.modalClose} onClick={() => setRescheduleTarget(null)} aria-label="Fechar"><X /></button><RotateCcw className={styles.rescheduleIcon} /><h2 id="reschedule-title">Reagendar reserva</h2><p>Novo slot troca atomicamente. Se falhar, reserva original permanece intacta. Itens mantidos preservam preço; substituição usa catálogo atual.</p><fieldset className={styles.rescheduleCatalog}><legend>Serviço ou pacote</legend><button type="button" className={!rescheduleChoiceId ? styles.selected : undefined} onClick={() => setRescheduleChoiceId("")}><strong>Manter itens atuais</strong><small>{rescheduleTarget.items.map((item) => item.service_name_snapshot).join(" + ")}</small></button>{catalogChoices(context).map((choice) => <button type="button" key={choice.id} className={rescheduleChoiceId === choice.id ? styles.selected : undefined} onClick={() => setRescheduleChoiceId(choice.id)}><strong>{choice.name}</strong><small>{formatMoney(choice.priceCents, context.organization.currency)}</small></button>)}</fieldset><label>Profissional<select value={barberId} onChange={(event) => setBarberId(event.target.value)}><option value="">Selecione</option>{compatibleBarbers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{compatibleBarbers.length === 0 && <p className={styles.empty}>Nenhum profissional habilitado para esta seleção.</p>}<div className={styles.dates}>{dateOptions(timezone, 10).map((date) => <button type="button" key={date} className={localDate === date ? styles.selected : undefined} onClick={() => setLocalDate(date)}><small>{formatLocalDate(date, { weekday: "short" })}</small><strong>{date.slice(-2)}</strong></button>)}</div>{slotsLoading ? <p className={styles.loadingLine}><LoaderCircle className={styles.spin} /> Consultando…</p> : <div className={styles.slots}>{slots.map((slot) => <button type="button" key={slot.starts_at} className={startsAt === slot.starts_at ? styles.selected : undefined} onClick={() => setStartsAt(slot.starts_at)}>{formatSlotTime(slot.starts_at, timezone)}</button>)}</div>}{!slotsLoading && !slots.length && !modalError && <p className={styles.empty}>Nenhum horário nesta data.</p>}{modalError && <p className={styles.error} role="alert">{modalError}</p>}<footer><button type="button" className={styles.secondaryButton} onClick={() => setRescheduleTarget(null)}>Voltar</button><button type="button" className={styles.primaryButton} disabled={!startsAt || !barberId || mutationBusy || Boolean(modalError)} onClick={() => void performReschedule()}>{mutationBusy ? "Reagendando…" : "Confirmar novo horário"}</button></footer></section></div>}
    </div>
  );
}

function ReservationCard({ appointment, timezone, barberName, onCancel, onReschedule, onResumePayment, paymentBusy, acceptingBookings }: { appointment: CustomerAppointment; timezone: string; barberName: string; onCancel: () => void; onReschedule: () => void; onResumePayment: () => void; paymentBusy: boolean; acceptingBookings: boolean }) {
  const { startsAt, endsAt } = parsePostgresRange(appointment.service_period);
  const canCancel = ["HELD", "PENDING_PAYMENT", "CONFIRMED"].includes(appointment.status);
  const canReschedule = canCustomerReschedule(appointment.status, startsAt, appointment.cancellation_lead_minutes_snapshot, acceptingBookings);
  const canResumePayment = appointment.status === "PENDING_PAYMENT" && Boolean(appointment.pending_payment_order_id);
  return <article className={styles.reservationCard}><header><span data-status={appointment.status}><Check size={13} /> {appointmentStatusLabel(appointment)}</span><small>{appointment.financial.financial_status.replaceAll("_", " ")}</small></header><div className={styles.reservationBody}><div className={styles.dateBox}><strong>{new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, day: "2-digit" }).format(new Date(startsAt))}</strong><span>{new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, month: "short" }).format(new Date(startsAt))}</span></div><div><h2>{appointment.items.map((item) => item.service_name_snapshot).join(" + ") || "Reserva"}</h2><p><Clock3 size={15} /> {formatSlotTime(startsAt, timezone)}–{formatSlotTime(endsAt, timezone)} · {barberName}</p><small>{formatInstant(startsAt, timezone, { dateStyle: "full", timeStyle: undefined })}</small></div><dl><div><dt>Total</dt><dd>{formatMoney(appointment.total_cents_snapshot, appointment.currency)}</dd></div><div><dt>Pago líquido</dt><dd>{formatMoney(appointment.financial.net_paid_cents, appointment.currency)}</dd></div><div><dt>Saldo</dt><dd>{formatMoney(appointment.financial.outstanding_cents, appointment.currency)}</dd></div></dl></div>{(canCancel || canReschedule || canResumePayment) && <footer>{canCancel && <button type="button" className={styles.textButton} onClick={onCancel}>Cancelar</button>}{canReschedule && <button type="button" className={styles.secondaryButton} onClick={onReschedule}><RotateCcw size={15} /> Reagendar</button>}{canResumePayment && <button type="button" className={styles.primaryButton} disabled={paymentBusy} onClick={onResumePayment}>{paymentBusy ? "Abrindo…" : "Retomar pagamento"}</button>}</footer>}</article>;
}
