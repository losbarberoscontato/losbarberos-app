"use client";

import { CalendarDays, Check, Clock3, LoaderCircle, Scissors, ShieldCheck, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  createAppointmentHold,
  getAvailableSlotsForDate,
  getAvailableSlots,
  toClientError,
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
import type { AvailableDateOption, AvailableSlot } from "@/components/connected-client/types";
import styles from "@/components/connected-client/connected-client.module.css";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { CATALOG_AUDIENCES, audienceLabel, filterByAudience, type CatalogAudience } from "@/lib/catalog-audiences";

type Draft = {
  choiceId: string;
  barberId: string;
  localDate: string;
  startsAt: string;
  step: number;
  audience?: CatalogAudience;
};

function draftKey(slug: string) {
  return `los-barberos:booking-draft:${slug}`;
}

export function ConnectedBooking() {
  return <ConnectedClientGate><BookingContent /></ConnectedClientGate>;
}

function BookingContent() {
  const { context, slug, user, customer } = useConnectedClient();
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [selectedAudience, setSelectedAudience] = useState<CatalogAudience | null>(null);
  const choices = useMemo(() => {
    if (!context || !selectedAudience) return [];
    return filterByAudience(catalogChoices(context), selectedAudience);
  }, [context, selectedAudience]);
  const dates = useMemo(() => context ? dateOptions(context.organization.timezone) : [], [context]);
  const [step, setStep] = useState(1);
  const [choiceId, setChoiceId] = useState("");
  const [barberId, setBarberId] = useState("");
  const [localDate, setLocalDate] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [dateAvailableSlots, setDateAvailableSlots] = useState<AvailableDateOption[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [restored, setRestored] = useState(false);

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
          if (typeof draft.audience === "string" && CATALOG_AUDIENCES.includes(draft.audience)) setSelectedAudience(draft.audience);
          if (typeof draft.barberId === "string") setBarberId(draft.barberId);
          if (typeof draft.localDate === "string") setLocalDate(draft.localDate);
          if (typeof draft.startsAt === "string") setStartsAt(draft.startsAt);
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
    const draft: Draft = { choiceId, barberId, localDate, startsAt, step, audience: selectedAudience ?? undefined };
    window.sessionStorage.setItem(draftKey(slug), JSON.stringify(draft));
  }, [barberId, choiceId, localDate, restored, selectedAudience, slug, startsAt, step]);

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

  useEffect(() => {
    if (!supabase || !context || !slug || !choice || !localDate || !context.organization.accepting_bookings) {
      queueMicrotask(() => setDateAvailableSlots([]));
      return;
    }
    let active = true;
    void getAvailableSlotsForDate(supabase, {
      organizationSlug: slug,
      localDate,
      selections: bookingSelection(choice),
    }).then((result) => {
      if (active) setDateAvailableSlots(result?.options ?? []);
    }).catch(() => {
      if (active) setDateAvailableSlots([]);
    });
    return () => { active = false; };
  }, [choice, context, localDate, slug, supabase]);

  if (!context || !slug) return null;
  const organization = context.organization;
  const tenantSlug = slug;
  const canContinue = step === 1 ? Boolean(choice) : step === 2 ? Boolean(choice && barber && startsAt) : false;

  async function confirmBooking() {
    if (!supabase || !choice || !barber || !startsAt || !user || !customer || !accepted) return;
    if (customer.auth_user_id !== user.id) {
      setError("Sua conta de cliente não corresponde a esta barbearia.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const hold = await createAppointmentHold(supabase, {
        organizationId: organization.id,
        customerId: customer.id,
        barberId: barber.id,
        startsAt,
        selections: bookingSelection(choice),
        paymentMode: "COUNTER",
      });
      window.sessionStorage.removeItem(draftKey(tenantSlug));
      router.push(`/cliente/reservas?barbearia=${encodeURIComponent(tenantSlug)}&appointment_id=${hold.appointment_id}`);
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
        <h1>{step === 1 ? "Escolha seu cuidado" : step === 2 ? "Escolha profissional e horário" : "Revise e confirme"}</h1>
        <p>{step === 3 ? "Reserva confirmada para pagamento no atendimento." : "Valores e duração vêm do catálogo atual da barbearia."}</p>
        <ol className={styles.steps} aria-label={`Etapa ${step} de 3`}>
          {["Serviço", "Horário", "Confirmar"].map((label, index) => <li key={label} className={step === index + 1 ? styles.current : step > index + 1 ? styles.done : undefined}><span>{step > index + 1 ? <Check size={13} /> : index + 1}</span>{label}</li>)}
        </ol>
      </header>

      {step === 1 && (
        <section className={styles.catalog} aria-labelledby="catalog-title">
          <div className={styles.sectionTitle}><Scissors aria-hidden="true" /><div><h2 id="catalog-title">Serviços e pacotes</h2><p>Uma seleção por visita no MVP.</p></div></div>
          <div className={styles.audienceFilter} role="tablist" aria-label="Público do serviço"><span>Escolha o público</span>{CATALOG_AUDIENCES.map((audience) => <button type="button" key={audience} role="tab" aria-selected={selectedAudience === audience} className={selectedAudience === audience ? styles.selected : undefined} onClick={() => { setSelectedAudience(audience); setChoiceId(""); setBarberId(""); }}>{audienceLabel(audience)}</button>)}</div>
          {!selectedAudience ? <p className={styles.empty}>Escolha um público para ver serviços e pacotes.</p> : !choices.length ? <p className={styles.empty}>Nenhum serviço disponível para este público.</p> : (
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
            {!barberId ? !dateAvailableSlots.length ? <p className={styles.empty}>Nenhum horário nesta data.</p> : <><p className={styles.empty}>Disponíveis nesta data</p><div className={styles.slots}>{dateAvailableSlots.map((slot) => <button type="button" key={`${slot.barber_id}:${slot.starts_at}`} onClick={() => { setBarberId(slot.barber_id); setStartsAt(slot.starts_at); }}>{formatSlotTime(slot.starts_at, organization.timezone)} · {slot.barber_name}</button>)}</div></> : slotsLoading ? <p className={styles.loadingLine}><LoaderCircle className={styles.spin} /> Consultando agenda…</p> : slotsError ? <p className={styles.error} role="alert">{slotsError}</p> : !slots.length ? <p className={styles.empty}>Nenhum horário nesta data.</p> : <div className={styles.slots}>{slots.map((slot) => <button type="button" key={slot.starts_at} className={startsAt === slot.starts_at ? styles.selected : undefined} aria-pressed={startsAt === slot.starts_at} onClick={() => setStartsAt(slot.starts_at)}>{formatSlotTime(slot.starts_at, organization.timezone)}</button>)}</div>}
          </section>
        </div>
      )}

      {step === 3 && choice && barber && startsAt && (
        <div className={styles.reviewGrid}>
          <div className={styles.reviewMain}>
            {!user ? <AuthPrompt description="Entre com e-mail para identificar seu cadastro antes de criar hold e pagamento." /> : (
              <>
                <section className={styles.panel}>
                  <div className={styles.sectionTitle}><UserRound aria-hidden="true" /><div><h2>Seus dados</h2><p>Nome e contato são gerenciados no seu perfil global.</p></div></div>
                  <p className={styles.empty}>{customer?.full_name ?? "Cliente"} · {customer?.phone_e164 ?? "Contato não informado"}</p>
                </section>
                <section className={styles.panel}>
                  <div className={styles.sectionTitle}><CalendarDays aria-hidden="true" /><div><h2>Pagamento</h2><p>Você paga o valor integral no atendimento.</p></div></div>
                </section>
                <label className={styles.policy}><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /><span><ShieldCheck size={17} /> Aceito a política desta reserva. Cancelamentos e alterações seguem o prazo informado pela barbearia.</span></label>
              </>
            )}
          </div>
          <aside className={styles.summary}>
            <span>Resumo</span><h2>{choice.name}</h2>
            <dl><div><dt>Profissional</dt><dd>{barber.name}</dd></div><div><dt>Data e hora</dt><dd>{formatLocalDate(localDate)} · {formatSlotTime(startsAt, organization.timezone)}</dd></div><div><dt>Total</dt><dd>{formatMoney(choice.priceCents, organization.currency)}</dd></div><div className={styles.due}><dt>Pagar no atendimento</dt><dd>{formatMoney(choice.priceCents, organization.currency)}</dd></div></dl>
            <p>Sem pagamento antecipado neste momento.</p>
          </aside>
        </div>
      )}

      {error && <div className={styles.errorBox} role="alert"><strong>Reserva não concluída</strong><span>{error}</span></div>}
      <footer className={styles.bookingFooter}>
        {step > 1 && <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => { setError(""); setStep((current) => current - 1); }}>Voltar</button>}
        <span>{choice && <><small>{choice.name}</small><strong>{formatMoney(choice.priceCents, organization.currency)}</strong></>}</span>
        {step < 3 ? <button type="button" className={styles.primaryButton} disabled={!canContinue} onClick={() => setStep((current) => current + 1)}>Continuar</button> : user ? <button type="button" className={styles.primaryButton} disabled={busy || !accepted} onClick={() => void confirmBooking()}>{busy ? <><LoaderCircle className={styles.spin} /> Processando…</> : "Confirmar reserva"}</button> : null}
      </footer>
    </div>
  );
}
