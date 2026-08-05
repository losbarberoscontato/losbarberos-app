"use client";

import { CalendarDays, Check, Clock3, CreditCard, LoaderCircle, LockKeyhole, Scissors, ShieldCheck, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  createAppointmentHold,
  createMercadoPagoCheckout,
  createPaymentCheckoutOrder,
  getAvailableSlots,
  recordWhatsappConsent,
  toClientError,
  upsertMyCustomer,
} from "@/components/connected-client/api";
import { useConnectedClient } from "@/components/connected-client/context";
import {
  bookingSelection,
  catalogChoices,
  dateOptions,
  formatLocalDate,
  formatMoney,
  formatSlotTime,
  barberSupportsServices,
  serviceIdsForChoice,
} from "@/components/connected-client/format";
import { AuthPrompt, ConnectedClientGate } from "@/components/connected-client/state";
import type { AvailableSlot } from "@/components/connected-client/types";
import styles from "@/components/connected-client/connected-client.module.css";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type Draft = {
  choiceId: string;
  barberId: string;
  localDate: string;
  startsAt: string;
  paymentMode: "DEPOSIT" | "FULL";
  step: number;
};

type PendingCheckout = { paymentOrderId: string; idempotencyKey: string };

function draftKey(slug: string) {
  return `los-barberos:booking-draft:${slug}`;
}

function makeIdempotencyKey(scope: string): string {
  return `${scope}:${crypto.randomUUID()}`;
}

export function ConnectedBooking() {
  return <ConnectedClientGate><BookingContent /></ConnectedClientGate>;
}

function BookingContent() {
  const { context, slug, user, customer, reloadCustomer } = useConnectedClient();
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const choices = useMemo(() => context ? catalogChoices(context) : [], [context]);
  const dates = useMemo(() => context ? dateOptions(context.organization.timezone) : [], [context]);
  const [step, setStep] = useState(1);
  const [choiceId, setChoiceId] = useState("");
  const [barberId, setBarberId] = useState("");
  const [localDate, setLocalDate] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState("");
  const [paymentMode, setPaymentMode] = useState<"DEPOSIT" | "FULL">("DEPOSIT");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [whatsappConsent, setWhatsappConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingCheckout, setPendingCheckout] = useState<PendingCheckout | null>(null);
  const [restored, setRestored] = useState(false);
  const [prefilledIdentity, setPrefilledIdentity] = useState("");

  const choice = choices.find((item) => item.id === choiceId) ?? null;
  const compatibleBarbers = useMemo(() => {
    if (!context || !choice) return context?.barbers ?? [];
    const requiredServices = serviceIdsForChoice(context, choice);
    return context.barbers.filter((item) =>
      barberSupportsServices(requiredServices, item.service_ids)
    );
  }, [choice, context]);
  const barber = compatibleBarbers.find((item) => item.id === barberId) ?? null;

  useEffect(() => {
    if (barberId && !compatibleBarbers.some((item) => item.id === barberId)) {
      queueMicrotask(() => setBarberId(""));
    }
  }, [barberId, compatibleBarbers]);

  useEffect(() => {
    if (!context || !slug || restored) return;
    queueMicrotask(() => {
      const raw = window.sessionStorage.getItem(draftKey(slug));
      if (raw) {
        try {
          const draft = JSON.parse(raw) as Partial<Draft>;
          if (typeof draft.choiceId === "string") setChoiceId(draft.choiceId);
          if (typeof draft.barberId === "string") setBarberId(draft.barberId);
          if (typeof draft.localDate === "string") setLocalDate(draft.localDate);
          if (typeof draft.startsAt === "string") setStartsAt(draft.startsAt);
          if (draft.paymentMode === "DEPOSIT" || draft.paymentMode === "FULL") setPaymentMode(draft.paymentMode);
          if (typeof draft.step === "number" && draft.step >= 1 && draft.step <= 3) setStep(draft.step);
        } catch {
          window.sessionStorage.removeItem(draftKey(slug));
        }
      }
      setLocalDate((current) => current || dates[0] || "");
      setRestored(true);
    });
  }, [context, dates, restored, slug]);

  useEffect(() => {
    if (!slug || !restored) return;
    const draft: Draft = { choiceId, barberId, localDate, startsAt, paymentMode, step };
    window.sessionStorage.setItem(draftKey(slug), JSON.stringify(draft));
  }, [barberId, choiceId, localDate, paymentMode, restored, slug, startsAt, step]);

  useEffect(() => {
    if (!user) return;
    const identity = `${user.id}:${customer?.id ?? "new"}`;
    if (prefilledIdentity === identity) return;
    queueMicrotask(() => {
      setFullName(customer?.full_name ?? String(user.user_metadata?.full_name ?? user.user_metadata?.name ?? ""));
      setPhone(customer?.phone_e164 ?? "");
      setEmail(customer?.email ?? user.email ?? "");
      setBirthDate(customer?.birth_date ?? "");
      setPrefilledIdentity(identity);
    });
  }, [customer, prefilledIdentity, user]);

  useEffect(() => {
    if (!supabase || !context || !slug || !choice || !barberId || !localDate || !context.organization.accepting_bookings) {
      queueMicrotask(() => setSlots([]));
      return;
    }
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setSlotsLoading(true);
      setSlotsError("");
      setStartsAt("");
    });
    void getAvailableSlots(supabase, {
      organizationSlug: slug,
      barberId,
      localDate,
      selections: bookingSelection(choice),
    }).then((result) => {
      if (active) setSlots(result?.slots ?? []);
    }).catch((cause: unknown) => {
      if (active) {
        setSlots([]);
        setSlotsError(toClientError(cause, "Não foi possível consultar horários."));
      }
    }).finally(() => {
      if (active) setSlotsLoading(false);
    });
    return () => { active = false; };
  }, [barberId, choice, context, localDate, slug, supabase]);

  if (!context || !slug) return null;
  const organization = context.organization;
  const tenantSlug = slug;
  const depositCents = choice ? Math.round(choice.priceCents * organization.deposit_bps / 10_000) : 0;
  const dueNow = paymentMode === "FULL" ? choice?.priceCents ?? 0 : depositCents;
  const canContinue = step === 1 ? Boolean(choice) : step === 2 ? Boolean(choice && barber && startsAt) : false;

  async function redirectToCheckout(pending: PendingCheckout) {
    if (!supabase) throw new Error("Supabase não configurado.");
    const checkoutUrl = await createMercadoPagoCheckout(supabase, pending.paymentOrderId, pending.idempotencyKey);
    window.localStorage.setItem("los-barberos:client-tenant", tenantSlug);
    window.sessionStorage.removeItem(draftKey(tenantSlug));
    window.location.assign(checkoutUrl);
  }

  async function confirmBooking() {
    if (!supabase || !choice || !barber || !startsAt || !user || !accepted || !whatsappConsent) return;
    if (!/^\+[1-9][0-9]{7,14}$/u.test(phone.trim())) {
      setError("Telefone deve estar em E.164. Exemplo: +5511999999999.");
      return;
    }
    if (fullName.trim().length < 2) {
      setError("Informe nome completo.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (pendingCheckout) {
        await redirectToCheckout(pendingCheckout);
        return;
      }
      const customerId = await upsertMyCustomer(supabase, {
        organizationId: organization.id,
        fullName: fullName.trim(),
        phoneE164: phone.trim(),
        email: email.trim() || null,
        birthDate: birthDate || null,
      });
      await recordWhatsappConsent(supabase, {
        organizationId: organization.id,
        customerId,
        granted: true,
        source: "PWA_BOOKING",
      });
      await reloadCustomer();
      const hold = await createAppointmentHold(supabase, {
        organizationId: organization.id,
        customerId,
        barberId: barber.id,
        startsAt,
        selections: bookingSelection(choice),
        paymentMode,
      });
      const order = await createPaymentCheckoutOrder(supabase, hold.appointment_id, makeIdempotencyKey("payment-order"));
      if (order.status === "CONFIRMED" || order.amount_cents === 0) {
        window.sessionStorage.removeItem(draftKey(tenantSlug));
        router.push(`/cliente/reservas?barbearia=${encodeURIComponent(tenantSlug)}&appointment_id=${hold.appointment_id}`);
        return;
      }
      if (!order.payment_order_id) throw new Error("Pedido de pagamento não retornado.");
      const pending = { paymentOrderId: order.payment_order_id, idempotencyKey: makeIdempotencyKey("mp-checkout") };
      setPendingCheckout(pending);
      await redirectToCheckout(pending);
    } catch (cause: unknown) {
      setError(toClientError(cause, "Não foi possível concluir reserva."));
    } finally {
      setBusy(false);
    }
  }

  if (!organization.accepting_bookings) {
    return (
      <section className={styles.bookingBlocked}>
        <Clock3 size={28} aria-hidden="true" />
        <span>Agenda temporariamente pausada</span>
        <h1>{organization.name} não aceita novas reservas agora.</h1>
        <p>Reservas existentes continuam disponíveis em “Reservas”. Tente novamente depois.</p>
      </section>
    );
  }

  return (
    <div className={styles.booking}>
      <header className={styles.pageHeading}>
        <span>Agendamento online · {organization.name}</span>
        <h1>{step === 1 ? "Escolha seu cuidado" : step === 2 ? "Escolha profissional e horário" : "Revise e pague"}</h1>
        <p>{step === 3 ? "Banco protege horário por 10 minutos. Webhook confirma pagamento." : "Valores e duração vêm do catálogo atual da barbearia."}</p>
        <ol className={styles.steps} aria-label={`Etapa ${step} de 3`}>
          {["Serviço", "Horário", "Confirmar"].map((label, index) => <li key={label} className={step === index + 1 ? styles.current : step > index + 1 ? styles.done : undefined}><span>{step > index + 1 ? <Check size={13} /> : index + 1}</span>{label}</li>)}
        </ol>
      </header>

      {step === 1 && (
        <section className={styles.catalog} aria-labelledby="catalog-title">
          <div className={styles.sectionTitle}><Scissors aria-hidden="true" /><div><h2 id="catalog-title">Serviços e pacotes</h2><p>Uma seleção por visita no MVP.</p></div></div>
          {!choices.length ? <p className={styles.empty}>Nenhum serviço disponível.</p> : (
            <div className={styles.cards}>
              {choices.map((item) => {
                const selected = item.id === choiceId;
                return <button type="button" key={`${item.kind}-${item.id}`} className={selected ? styles.selected : undefined} aria-pressed={selected} onClick={() => setChoiceId(item.id)}><span className={styles.choiceKind}>{item.kind === "PACKAGE" ? "Pacote" : "Serviço"}</span><strong>{item.name}</strong><small>{item.description || "Detalhes informados pela barbearia."}</small><span className={styles.choiceMeta}><Clock3 size={14} /> {item.durationMinutes} min <b>{formatMoney(item.priceCents, organization.currency)}</b></span>{selected && <i><Check size={15} /></i>}</button>;
              })}
            </div>
          )}
        </section>
      )}

      {step === 2 && choice && (
        <div className={styles.schedule}>
          <section>
            <div className={styles.sectionTitle}><UserRound aria-hidden="true" /><div><h2>Profissional</h2><p>Escolha quem fará todos os itens.</p></div></div>
            {!compatibleBarbers.length ? <p className={styles.empty}>Nenhum profissional habilitado para esta seleção.</p> : <div className={styles.barbers}>{compatibleBarbers.map((item) => <button type="button" key={item.id} aria-pressed={barberId === item.id} className={barberId === item.id ? styles.selected : undefined} onClick={() => setBarberId(item.id)}><span>{item.name.slice(0, 2).toUpperCase()}</span><strong>{item.name}</strong><small>{item.bio || "Profissional da equipe"}</small></button>)}</div>}
          </section>
          <section>
            <div className={styles.sectionTitle}><CalendarDays aria-hidden="true" /><div><h2>Data</h2><p>Horários calculados no fuso {organization.timezone}.</p></div></div>
            <div className={styles.dates}>{dates.map((date) => <button type="button" key={date} className={localDate === date ? styles.selected : undefined} aria-pressed={localDate === date} onClick={() => setLocalDate(date)}><small>{formatLocalDate(date, { weekday: "short" })}</small><strong>{date.slice(-2)}</strong><span>{formatLocalDate(date, { month: "short" }).replace(/\d/gu, "").replace(/[,.]/gu, "").trim()}</span></button>)}</div>
          </section>
          <section>
            <div className={styles.sectionTitle}><Clock3 aria-hidden="true" /><div><h2>Horário</h2><p>Consulta não garante reserva; constraint do banco decide no clique final.</p></div></div>
            {!barberId ? <p className={styles.empty}>Escolha profissional primeiro.</p> : slotsLoading ? <p className={styles.loadingLine}><LoaderCircle className={styles.spin} /> Consultando agenda…</p> : slotsError ? <p className={styles.error} role="alert">{slotsError}</p> : !slots.length ? <p className={styles.empty}>Nenhum horário nesta data.</p> : <div className={styles.slots}>{slots.map((slot) => <button type="button" key={slot.starts_at} className={startsAt === slot.starts_at ? styles.selected : undefined} aria-pressed={startsAt === slot.starts_at} onClick={() => setStartsAt(slot.starts_at)}>{formatSlotTime(slot.starts_at, organization.timezone)}</button>)}</div>}
          </section>
        </div>
      )}

      {step === 3 && choice && barber && startsAt && (
        <div className={styles.reviewGrid}>
          <div className={styles.reviewMain}>
            {!user ? <AuthPrompt description="Google identifica cliente antes de criar hold e pagamento." /> : (
              <>
                <section className={styles.panel}>
                  <div className={styles.sectionTitle}><UserRound aria-hidden="true" /><div><h2>Seus dados</h2><p>Telefone E.164 recebe confirmações transacionais.</p></div></div>
                  <div className={styles.formGrid}>
                    <label>Nome completo<input value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" required /></label>
                    <label>WhatsApp<input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+5511999999999" inputMode="tel" autoComplete="tel" required /></label>
                    <label>E-mail<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>
                    <label>Nascimento <small>opcional</small><input type="date" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} /></label>
                  </div>
                </section>
                <section className={styles.panel}>
                  <div className={styles.sectionTitle}><CreditCard aria-hidden="true" /><div><h2>Valor agora</h2><p>Pagamento seguro via Mercado Pago conectado à barbearia.</p></div></div>
                  <div className={styles.paymentModes}>
                    <button type="button" className={paymentMode === "DEPOSIT" ? styles.selected : undefined} aria-pressed={paymentMode === "DEPOSIT"} onClick={() => setPaymentMode("DEPOSIT")}><span><strong>Sinal · {organization.deposit_bps / 100}%</strong><small>Saldo de {formatMoney(choice.priceCents - depositCents, organization.currency)} no atendimento</small></span><b>{formatMoney(depositCents, organization.currency)}</b></button>
                    <button type="button" className={paymentMode === "FULL" ? styles.selected : undefined} aria-pressed={paymentMode === "FULL"} onClick={() => setPaymentMode("FULL")}><span><strong>Valor integral</strong><small>Sem saldo no atendimento</small></span><b>{formatMoney(choice.priceCents, organization.currency)}</b></button>
                  </div>
                </section>
                <label className={styles.policy}><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /><span><ShieldCheck size={17} /> Aceito política congelada desta reserva: cancelamento até {Math.round(organization.cancellation_lead_minutes / 60)}h antes segue reembolso previsto.</span></label>
                <label className={styles.policy}><input type="checkbox" checked={whatsappConsent} onChange={(event) => setWhatsappConsent(event.target.checked)} /><span><ShieldCheck size={17} /> Autorizo WhatsApp transacional para confirmação, lembrete e alterações desta reserva. Não autoriza marketing.</span></label>
              </>
            )}
          </div>
          <aside className={styles.summary}>
            <span>Resumo</span><h2>{choice.name}</h2>
            <dl><div><dt>Profissional</dt><dd>{barber.name}</dd></div><div><dt>Data e hora</dt><dd>{formatLocalDate(localDate)} · {formatSlotTime(startsAt, organization.timezone)}</dd></div><div><dt>Total</dt><dd>{formatMoney(choice.priceCents, organization.currency)}</dd></div><div className={styles.due}><dt>Pagar agora</dt><dd>{formatMoney(dueNow, organization.currency)}</dd></div></dl>
            <p><LockKeyhole size={15} /> Redirect não confirma reserva. Somente webhook assinado.</p>
          </aside>
        </div>
      )}

      {error && <div className={styles.errorBox} role="alert"><strong>Reserva não concluída</strong><span>{error}</span>{pendingCheckout && <small>Horário já protegido. “Tentar pagamento” reutiliza mesmo pedido; não cria outra reserva.</small>}</div>}
      <footer className={styles.bookingFooter}>
        {step > 1 && <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => { setError(""); setStep((current) => current - 1); }}>Voltar</button>}
        <span>{choice && <><small>{choice.name}</small><strong>{formatMoney(choice.priceCents, organization.currency)}</strong></>}</span>
        {step < 3 ? <button type="button" className={styles.primaryButton} disabled={!canContinue} onClick={() => setStep((current) => current + 1)}>Continuar</button> : user ? <button type="button" className={styles.primaryButton} disabled={busy || !accepted || !whatsappConsent} onClick={() => void confirmBooking()}>{busy ? <><LoaderCircle className={styles.spin} /> Processando…</> : pendingCheckout ? "Tentar pagamento" : `Pagar ${formatMoney(dueNow, organization.currency)}`}</button> : null}
      </footer>
    </div>
  );
}
