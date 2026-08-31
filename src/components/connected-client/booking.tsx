"use client";

import { CalendarDays, Check, Clock3, LoaderCircle, Scissors, ShieldCheck, UserRound, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  acquireBookingHold,
  bookingErrorKind,
  confirmBookingHold,
  getCustomerPrivacy,
  getAvailableSlotsForDate,
  getAvailableSlots,
  releaseBookingHold,
  toClientError,
  type BookingHold,
} from "@/components/connected-client/api";
import { useConnectedClient } from "@/components/connected-client/context";
import { holdStorageKey } from "@/components/walkin-queue";
import {
  bookingSelection,
  catalogChoices,
  dateOptions,
  filterByChoiceKind,
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
  barberMode?: BarberMode;
  barberId: string;
  localDate: string;
  startsAt: string;
  step: number;
  audience?: CatalogAudience;
};

type CatalogChoiceKindFilter = "ALL" | "SERVICE" | "PACKAGE";
type BarberMode = "ANY" | "SPECIFIC" | "";

const BOOKING_STEPS = ["Serviço", "Barbeiro", "Horário", "Confirmar"] as const;

function periodLabel(startsAt: string, timezone: string) {
  const hour = Number(new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).format(new Date(startsAt)).slice(0, 2));
  if (hour < 12) return "Manhã";
  if (hour < 18) return "Tarde";
  return "Noite";
}

function isAvailableDateOption(slot: AvailableSlot | AvailableDateOption): slot is AvailableDateOption {
  return "barber_id" in slot;
}

function bookingDateParts(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "UTC",
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).formatToParts(new Date(Date.UTC(year, month - 1, day, 12)));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value.replace(".", "") ?? "";
  return { weekday: part("weekday"), day: part("day"), month: part("month") };
}

function draftKey(slug: string) {
  return `los-barberos:booking-draft:${slug}`;
}

function bookingHoldStorageKey(slug: string, userId: string, customerId: string) {
  return `los-barberos:booking-hold:${slug}:${userId}:${customerId}`;
}

function countdownLabel(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  return `${String(Math.floor(safeSeconds / 60)).padStart(2, "0")}:${String(safeSeconds % 60).padStart(2, "0")}`;
}

export function ConnectedBooking() {
  return <ConnectedClientGate><BookingContent /></ConnectedClientGate>;
}

function BookingContent() {
  const { context, slug, user, customer } = useConnectedClient();
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [selectedAudience, setSelectedAudience] = useState<CatalogAudience | null>(null);
  const [selectedChoiceKind, setSelectedChoiceKind] = useState<CatalogChoiceKindFilter>("ALL");
  const choices = useMemo(() => {
    if (!context || !selectedAudience) return [];
    return filterByChoiceKind(filterByAudience(catalogChoices(context), selectedAudience), selectedChoiceKind);
  }, [context, selectedAudience, selectedChoiceKind]);
  const dates = useMemo(() => context ? dateOptions(context.organization.timezone) : [], [context]);
  const [step, setStep] = useState(1);
  const [choiceId, setChoiceId] = useState("");
  const [barberMode, setBarberMode] = useState<BarberMode>("");
  const [barberId, setBarberId] = useState("");
  const [localDate, setLocalDate] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [walkinQueueHoldId, setWalkinQueueHoldId] = useState<string | null>(null);
  const [bookingHold, setBookingHold] = useState<BookingHold | null>(null);
  const [holdSeconds, setHoldSeconds] = useState(0);
  const holdRequestKeyRef = useRef("");
  // A vaga escolhida na fila pública sobrevive à seleção do serviço após login.
  // O cliente ainda pode substituí-la explicitamente nos passos 2/3.
  const queuePresetRef = useRef<{ barberId: string; startsAt: string } | null>(null);
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [dateAvailableSlots, setDateAvailableSlots] = useState<AvailableDateOption[]>([]);
  const [dateSlotsLoading, setDateSlotsLoading] = useState(false);
  const [dateSlotsError, setDateSlotsError] = useState("");
  const [availabilityRetry, setAvailabilityRetry] = useState(0);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [whatsappAccepted, setWhatsappAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [restored, setRestored] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dialogBodyRef = useRef<HTMLDivElement>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);

  const choice = choices.find((item) => item.id === choiceId) ?? null;
  const resetBookingHold = useCallback((options?: { clearSlot?: boolean; refreshAvailability?: boolean }) => {
    setBookingHold(null);
    setAccepted(false);
    holdRequestKeyRef.current = "";
    if (options?.clearSlot) setStartsAt("");
    if (options?.refreshAvailability) setAvailabilityRetry((current) => current + 1);
    if (slug && user && customer) {
      window.sessionStorage.removeItem(bookingHoldStorageKey(slug, user.id, customer.id));
    }
  }, [customer, slug, user]);

  useEffect(() => {
    if (!slug) return;
    const query = new URLSearchParams(window.location.search);
    const barber = query.get("barbeiro");
    const starts = query.get("horario");
    const stored = window.sessionStorage.getItem(holdStorageKey);
    const bookingStorageKey = user && customer
      ? bookingHoldStorageKey(slug, user.id, customer.id)
      : null;
    const storedBookingHold = bookingStorageKey
      ? window.sessionStorage.getItem(bookingStorageKey)
      : null;
    queueMicrotask(() => {
      if (barber) {
        queuePresetRef.current = starts && !Number.isNaN(new Date(starts).getTime())
          ? { barberId: barber, startsAt: starts }
          : null;
        setBarberMode("SPECIFIC");
        setBarberId(barber);
      }
      if (starts && !Number.isNaN(new Date(starts).getTime())) {
        setStartsAt(starts);
        setLocalDate(starts.slice(0, 10));
      }
      if (stored) {
        try {
          const hold = JSON.parse(stored) as { id?: string; expiresAt?: string };
          if (hold.id && hold.expiresAt && new Date(hold.expiresAt) > new Date()) setWalkinQueueHoldId(hold.id);
        } catch {
          window.sessionStorage.removeItem(holdStorageKey);
        }
      }
      if (storedBookingHold) {
        try {
          const hold = JSON.parse(storedBookingHold) as BookingHold;
          if (hold.status === "HELD" && hold.expires_at && new Date(hold.expires_at) > new Date()) {
            setBookingHold(hold);
            setStep(4);
          } else {
            window.sessionStorage.removeItem(bookingStorageKey!);
          }
        } catch {
          window.sessionStorage.removeItem(bookingStorageKey!);
        }
      }
    });
  }, [customer, slug, user]);
  const compatibleBarbers = useMemo(() => {
    if (!context || !choice) return context?.barbers ?? [];
    const requiredServices = serviceIdsForChoice(context, choice);
    return context.barbers.filter((item) =>
      barberSupportsServices(requiredServices, item.service_ids)
    );
  }, [choice, context]);
  const barber = compatibleBarbers.find((item) => item.id === barberId) ?? null;

  useEffect(() => {
    if (!supabase || !context || !customer) {
      queueMicrotask(() => setWhatsappAccepted(false));
      return;
    }
    let active = true;
    void getCustomerPrivacy(supabase, context.organization.id, customer.id)
      .then((privacy) => {
        if (active) setWhatsappAccepted(privacy.whatsappGranted);
      })
      .catch(() => {
        if (active) setWhatsappAccepted(false);
      });
    return () => { active = false; };
  }, [context, customer, supabase]);

  useEffect(() => {
    if (barberId && !compatibleBarbers.some((item) => item.id === barberId)) {
      queueMicrotask(() => {
        setBarberId("");
        setStartsAt("");
        if (barberMode === "SPECIFIC") setBarberMode("");
      });
    }
  }, [barberId, barberMode, compatibleBarbers]);

  useEffect(() => {
    if (!context || !slug || restored) return;
    queueMicrotask(() => {
      const raw = window.sessionStorage.getItem(draftKey(slug));
      if (raw) {
        try {
          const draft = JSON.parse(raw) as Partial<Draft>;
          if (typeof draft.choiceId === "string") setChoiceId(draft.choiceId);
          if (typeof draft.audience === "string" && CATALOG_AUDIENCES.includes(draft.audience)) setSelectedAudience(draft.audience);
          if (!queuePresetRef.current) {
            if (draft.barberMode === "ANY" || draft.barberMode === "SPECIFIC") setBarberMode(draft.barberMode);
            else if (typeof draft.barberId === "string" && draft.barberId) setBarberMode("SPECIFIC");
            if (typeof draft.barberId === "string") setBarberId(draft.barberId);
          }
          if (typeof draft.localDate === "string") setLocalDate(draft.localDate);
          if (!queuePresetRef.current && typeof draft.startsAt === "string") setStartsAt(draft.startsAt);
          if (typeof draft.step === "number" && draft.step >= 1 && draft.step <= 4) {
            const storedHold = user && customer
              ? window.sessionStorage.getItem(bookingHoldStorageKey(slug, user.id, customer.id))
              : null;
            let hasActiveHold = false;
            if (storedHold) {
              try {
                const hold = JSON.parse(storedHold) as BookingHold;
                hasActiveHold = hold.status === "HELD" && Boolean(hold.expires_at) && new Date(hold.expires_at ?? 0) > new Date();
              } catch {
                window.sessionStorage.removeItem(bookingHoldStorageKey(slug, user!.id, customer!.id));
              }
            }
            setStep(draft.step === 4 && !hasActiveHold ? 3 : draft.step);
          }
        } catch {
          window.sessionStorage.removeItem(draftKey(slug));
        }
      }
      setLocalDate((current) => current || dates[0] || "");
      setRestored(true);
    });
  }, [context, customer, dates, restored, slug, user]);

  useEffect(() => {
    if (!slug || !restored) return;
    const draft: Draft = { choiceId, barberMode, barberId, localDate, startsAt, step, audience: selectedAudience ?? undefined };
    window.sessionStorage.setItem(draftKey(slug), JSON.stringify(draft));
  }, [barberId, barberMode, choiceId, localDate, restored, selectedAudience, slug, startsAt, step]);

  useEffect(() => {
    if (!bookingHold?.expires_at || !supabase || !slug) {
      queueMicrotask(() => setHoldSeconds(0));
      return;
    }
    const expiresAt = new Date(bookingHold.expires_at).getTime();
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setHoldSeconds(remaining);
      if (remaining > 0) return;
      const expiredId = bookingHold.appointment_id;
      resetBookingHold({ clearSlot: true, refreshAvailability: true });
      setStep(3);
      setError("O tempo para concluir terminou. Escolha o horário novamente.");
      void releaseBookingHold(supabase, expiredId).catch(() => undefined);
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [bookingHold, resetBookingHold, slug, supabase]);

  useEffect(() => {
    if (!supabase || !context || !slug || !choice || barberMode !== "SPECIFIC" || !barberId || !localDate || !context.organization.accepting_bookings) {
      queueMicrotask(() => setSlots([]));
      return;
    }
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setSlotsLoading(true);
      setSlotsError("");
      // Ao converter a vaga da fila em hold de agendamento, o hold da fila é
      // consumido. Não limpe o horário enquanto o novo hold estiver ativo.
      if (!walkinQueueHoldId && !bookingHold) setStartsAt("");
    });
    void getAvailableSlots(supabase, {
      organizationSlug: slug,
      barberId,
      localDate,
      selections: bookingSelection(choice),
      walkinQueueHoldId,
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
  }, [availabilityRetry, barberId, barberMode, bookingHold, choice, context, localDate, slug, supabase, walkinQueueHoldId]);

  useEffect(() => {
    if (!supabase || !context || !slug || !choice || barberMode !== "ANY" || !localDate || !context.organization.accepting_bookings) {
      queueMicrotask(() => {
        setDateAvailableSlots([]);
        setDateSlotsLoading(false);
        setDateSlotsError("");
      });
      return;
    }
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setDateSlotsLoading(true);
      setDateSlotsError("");
    });
    void getAvailableSlotsForDate(supabase, {
      organizationSlug: slug,
      localDate,
      selections: bookingSelection(choice),
    }).then((result) => {
      if (active) setDateAvailableSlots(result?.options ?? []);
    }).catch((cause: unknown) => {
      if (active) {
        setDateAvailableSlots([]);
        setDateSlotsError(toClientError(cause, "Não foi possível consultar horários."));
      }
    }).finally(() => {
      if (active) setDateSlotsLoading(false);
    });
    return () => { active = false; };
  }, [availabilityRetry, barberMode, choice, context, localDate, slug, supabase]);

  useEffect(() => {
    if (!context?.organization.accepting_bookings) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function") {
      if (dialog.open) dialog.close();
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
    window.requestAnimationFrame(() => stepHeadingRef.current?.focus());
    return () => {
      if (typeof dialog.close === "function" && dialog.open) dialog.close();
    };
  }, [context?.organization.accepting_bookings]);

  useEffect(() => {
    if (!restored) return;
    if (dialogBodyRef.current) dialogBodyRef.current.scrollTop = 0;
    window.requestAnimationFrame(() => stepHeadingRef.current?.focus());
  }, [restored, step]);

  if (!context || !slug) return null;
  const organization = context.organization;
  const tenantSlug = slug;
  const canContinue = step === 1
    ? Boolean(choice)
    : step === 2
      ? Boolean(choice && (barberMode === "ANY" || (barberMode === "SPECIFIC" && barber)))
      : step === 3
        ? Boolean(choice && barber && startsAt)
        : false;
  const visibleSlots: Array<AvailableSlot | AvailableDateOption> = barberMode === "ANY" ? dateAvailableSlots : slots;
  const groupedSlots = visibleSlots.reduce<Array<{ label: string; slots: Array<AvailableSlot | AvailableDateOption> }>>((groups, slot) => {
    const label = periodLabel(slot.starts_at, organization.timezone);
    const group = groups.find((item) => item.label === label);
    if (group) group.slots.push(slot);
    else groups.push({ label, slots: [slot] });
    return groups;
  }, []);

  function resetBookingAfterChoice() {
    if (queuePresetRef.current) return;
    setBarberMode("");
    setBarberId("");
    setStartsAt("");
    holdRequestKeyRef.current = "";
  }

  function selectDate(date: string) {
    setLocalDate(date);
    setStartsAt("");
    holdRequestKeyRef.current = "";
    if (barberMode === "ANY") setBarberId("");
  }

  async function protectBookingForReview() {
    if (!supabase || !choice || !barber || !startsAt || !user || !customer) return;
    if (customer.auth_user_id !== user.id) {
      setError("Sua conta de cliente não corresponde a esta barbearia.");
      return;
    }
    setBusy(true);
    setError("");
    const requestKey = holdRequestKeyRef.current || crypto.randomUUID();
    holdRequestKeyRef.current = requestKey;
    try {
      const hold = await acquireBookingHold(supabase, {
        organizationId: organization.id,
        customerId: customer.id,
        barberId: barber.id,
        startsAt,
        selections: bookingSelection(choice),
        idempotencyKey: requestKey,
        walkinQueueHoldId,
      });
      if (hold.status === "CONFIRMED") {
        window.sessionStorage.removeItem(holdStorageKey);
        setWalkinQueueHoldId(null);
        window.sessionStorage.removeItem(draftKey(tenantSlug));
        router.push(`/cliente/reservas?barbearia=${encodeURIComponent(tenantSlug)}&appointment_id=${hold.appointment_id}`);
        return;
      }
      if (!hold.expires_at) throw new Error("appointment hold expired");
      setBookingHold(hold);
      window.sessionStorage.setItem(
        bookingHoldStorageKey(tenantSlug, user.id, customer.id),
        JSON.stringify(hold),
      );
      window.sessionStorage.removeItem(holdStorageKey);
      setWalkinQueueHoldId(null);
      setStep(4);
    } catch (cause: unknown) {
      const errorKind = bookingErrorKind(cause);
      const clientError = toClientError(cause, "Não foi possível proteger horário.");
      setError(clientError);
      if (errorKind === "CONFLICT" || errorKind === "EXPIRED") {
        window.sessionStorage.removeItem(holdStorageKey);
        setWalkinQueueHoldId(null);
        resetBookingHold({ clearSlot: true, refreshAvailability: true });
        setStep(3);
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmBooking() {
    if (!supabase || !bookingHold || !user || !customer || !accepted) return;
    setBusy(true);
    setError("");
    try {
      const confirmed = await confirmBookingHold(supabase, bookingHold.appointment_id);
      if (confirmed.status === "EXPIRED") throw new Error("appointment hold expired");
      resetBookingHold();
      window.sessionStorage.removeItem(draftKey(tenantSlug));
      router.push(`/cliente/reservas?barbearia=${encodeURIComponent(tenantSlug)}&appointment_id=${confirmed.appointment_id}`);
    } catch (cause: unknown) {
      const errorKind = bookingErrorKind(cause);
      const clientError = toClientError(cause, "Não foi possível concluir reserva.");
      setError(clientError);
      if (errorKind === "EXPIRED" || errorKind === "CONFLICT") {
        resetBookingHold({ clearSlot: true, refreshAvailability: true });
        setStep(3);
      }
    } finally {
      setBusy(false);
    }
  }

  function releaseReviewHold(onSettled?: () => void) {
    const currentHold = bookingHold;
    resetBookingHold();
    if (!supabase || !currentHold) {
      onSettled?.();
      return;
    }
    void releaseBookingHold(supabase, currentHold.appointment_id)
      .catch(() => undefined)
      .finally(onSettled);
  }

  function backFromCurrentStep() {
    setError("");
    if (step !== 4) {
      setStep((current) => current - 1);
      return;
    }
    releaseReviewHold(() => setAvailabilityRetry((current) => current + 1));
    setStep(3);
  }

  function exitBooking() {
    releaseReviewHold();
    window.sessionStorage.removeItem(draftKey(tenantSlug));
    router.push(exitHref);
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

  const stepTitle = step === 1
    ? "Qual serviço você quer?"
    : step === 2
      ? "Quem vai cuidar de você?"
      : step === 3
        ? "Quando fica melhor?"
        : "Revise e agende";
  const stepDescription = step === 1
    ? "Escolha um serviço ou pacote do catálogo da barbearia."
    : step === 2
      ? "Escolha um barbeiro ou deixe o sistema encontrar o primeiro horário livre."
      : step === 3
        ? "Selecione a data e um horário ainda disponível."
        : "Confira os dados e confirme. O pagamento será feito no atendimento.";
  const exitHref = `/cliente?barbearia=${encodeURIComponent(tenantSlug)}`;

  return (
    <dialog
      ref={dialogRef}
      open
      className={styles.bookingDialog}
      aria-modal="true"
      aria-labelledby="booking-step-title"
      aria-describedby="booking-step-description"
      onCancel={(event) => {
        event.preventDefault();
        void exitBooking();
      }}
    >
      <header className={styles.bookingDialogHeader}>
        <div className={styles.bookingContext}>
          <span>{organization.name}</span>
          <span>Etapa {step} de 4</span>
          <button type="button" className={styles.bookingClose} aria-label="Fechar agendamento" disabled={busy} onClick={() => void exitBooking()}>
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <h1 ref={stepHeadingRef} tabIndex={-1} id="booking-step-title">{stepTitle}</h1>
        <p id="booking-step-description">{stepDescription}</p>
        <ol className={styles.steps} aria-label={`Etapa ${step} de 4`}>
          {BOOKING_STEPS.map((label, index) => {
            const itemStep = index + 1;
            return (
              <li
                key={label}
                aria-current={step === itemStep ? "step" : undefined}
                className={step === itemStep ? styles.current : step > itemStep ? styles.done : undefined}
              >
                <span>{step > itemStep ? <Check size={14} aria-hidden="true" /> : itemStep}</span>
                {label}
              </li>
            );
          })}
        </ol>
      </header>

      <div ref={dialogBodyRef} className={styles.bookingDialogBody}>
        {step > 1 && choice && (
          <div className={styles.selectionStrip}>
            <Scissors size={18} aria-hidden="true" />
            <span><small>Seu serviço</small><strong>{choice.name}</strong></span>
            <b>{formatMoney(choice.priceCents, organization.currency)}</b>
          </div>
        )}

        {step === 1 && (
          <section className={styles.bookingStep} aria-label="Escolher serviço">
            <div className={styles.audienceFilter} role="tablist" aria-label="Público do serviço">
              <span>Para quem é o serviço?</span>
              {CATALOG_AUDIENCES.map((audience) => (
                <button
                  type="button"
                  key={audience}
                  role="tab"
                  aria-selected={selectedAudience === audience}
                  className={selectedAudience === audience ? styles.selected : undefined}
                  onClick={() => {
                    setSelectedAudience(audience);
                    setChoiceId("");
                    resetBookingAfterChoice();
                  }}
                >
                  {audienceLabel(audience)}
                </button>
              ))}
            </div>
            {!selectedAudience ? (
              <p className={styles.empty}>Escolha o público para ver serviços e pacotes.</p>
            ) : !choices.length ? (
              <p className={styles.empty}>Nenhum serviço disponível para este público.</p>
            ) : (
              <>
                <div className={styles.audienceFilter} role="tablist" aria-label="Tipo de item">
                  <span>O que você procura?</span>
                  {([['ALL', 'Todos'], ['SERVICE', 'Serviços'], ['PACKAGE', 'Pacotes']] as const).map(([kind, label]) => (
                    <button
                      type="button"
                      key={kind}
                      role="tab"
                      aria-selected={selectedChoiceKind === kind}
                      className={selectedChoiceKind === kind ? styles.selected : undefined}
                      onClick={() => {
                        setSelectedChoiceKind(kind);
                        setChoiceId("");
                        resetBookingAfterChoice();
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className={styles.cards}>
                  {choices.map((item) => {
                    const selected = item.id === choiceId;
                    return (
                      <button
                        type="button"
                        key={`${item.kind}-${item.id}`}
                        className={selected ? styles.selected : undefined}
                        aria-pressed={selected}
                        onClick={() => {
                          if (item.id !== choiceId) resetBookingAfterChoice();
                          setChoiceId(item.id);
                        }}
                      >
                        <span className={styles.choiceKind}>{item.kind === "PACKAGE" ? "Pacote" : "Serviço"}</span>
                        <strong>{item.name}</strong>
                        <small>{item.description || "Detalhes informados pela barbearia."}</small>
                        <span className={styles.choiceMeta}><Clock3 size={14} aria-hidden="true" /> {item.durationMinutes} min <b>{formatMoney(item.priceCents, organization.currency)}</b></span>
                        {selected && <i><Check size={15} aria-hidden="true" /></i>}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        )}

        {step === 2 && choice && (
          <section className={styles.bookingStep} aria-label="Escolher barbeiro">
            {!compatibleBarbers.length ? (
              <p className={styles.empty}>Nenhum profissional habilitado para este serviço.</p>
            ) : (
              <>
                <button
                  type="button"
                  className={`${styles.anyBarber} ${barberMode === "ANY" ? styles.selected : ""}`}
                  aria-pressed={barberMode === "ANY"}
                  onClick={() => {
                    queuePresetRef.current = null;
                    setBarberMode("ANY");
                    setBarberId("");
                    setStartsAt("");
                    holdRequestKeyRef.current = "";
                  }}
                >
                  <span><Clock3 size={22} aria-hidden="true" /></span>
                  <span><strong>Primeiro horário livre</strong><small>Escolha o horário e informamos qual barbeiro está disponível.</small></span>
                  {barberMode === "ANY" && <Check size={20} aria-hidden="true" />}
                </button>
                <div className={styles.choiceDivider}><span>ou escolha um barbeiro</span></div>
                <div className={styles.barbers}>
                  {compatibleBarbers.map((item) => {
                    const selected = barberMode === "SPECIFIC" && barberId === item.id;
                    return (
                      <button
                        type="button"
                        key={item.id}
                        aria-pressed={selected}
                        className={selected ? styles.selected : undefined}
                        onClick={() => {
                          queuePresetRef.current = null;
                          setBarberMode("SPECIFIC");
                          setBarberId(item.id);
                          setStartsAt("");
                          holdRequestKeyRef.current = "";
                        }}
                      >
                        <span>{item.avatar_url ? <Image src={item.avatar_url} alt="" width={42} height={42} sizes="42px" /> : item.name.slice(0, 2).toUpperCase()}</span>
                        <strong>{item.name}</strong>
                        <small>{item.bio || "Profissional da equipe"}</small>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        )}

        {step === 3 && choice && barberMode && (
          <section className={styles.bookingStep} aria-label="Escolher data e horário">
            <div className={styles.scheduleIntro}>
              <CalendarDays size={20} aria-hidden="true" />
              <span>
                <strong>{barberMode === "ANY" ? "Primeiro horário livre" : barber?.name}</strong>
                <small>Horário sujeito à disponibilidade até a confirmação final.</small>
              </span>
            </div>
            <div className={styles.scheduleGroup}>
              <h2>Escolha a data</h2>
              <div className={styles.dates}>
                {dates.map((date) => {
                  const dateParts = bookingDateParts(date);
                  return (
                    <button type="button" key={date} className={localDate === date ? styles.selected : undefined} aria-pressed={localDate === date} onClick={() => selectDate(date)}>
                      <small>{dateParts.weekday}</small>
                      <strong>{dateParts.day}</strong>
                      <span>{dateParts.month}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className={styles.scheduleGroup}>
              <h2>Escolha o horário</h2>
              {(barberMode === "ANY" ? dateSlotsLoading : slotsLoading) ? (
                <p className={styles.loadingLine} role="status" aria-live="polite"><LoaderCircle className={styles.spin} /> Consultando agenda…</p>
              ) : (barberMode === "ANY" ? dateSlotsError : slotsError) ? (
                <div className={styles.availabilityError} role="alert">
                  <span>{barberMode === "ANY" ? dateSlotsError : slotsError}</span>
                  <button type="button" className={styles.secondaryButton} onClick={() => setAvailabilityRetry((current) => current + 1)}>Tentar novamente</button>
                </div>
              ) : !groupedSlots.length ? (
                <p className={styles.empty}>Nenhum horário disponível nesta data. Escolha outro dia.</p>
              ) : (
                <div className={styles.slotGroups}>
                  {groupedSlots.map((group) => (
                    <section key={group.label} aria-labelledby={`slot-period-${group.label}`}>
                      <h3 id={`slot-period-${group.label}`}>{group.label}</h3>
                      <div className={`${styles.slots} ${barberMode === "ANY" ? styles.slotsWithBarber : ""}`}>
                        {group.slots.map((slot) => {
                          const assignedBarberId = isAvailableDateOption(slot) ? slot.barber_id : barberId;
                          const selected = startsAt === slot.starts_at && barberId === assignedBarberId;
                          return (
                            <button
                              type="button"
                              key={`${assignedBarberId}:${slot.starts_at}`}
                              className={selected ? styles.selected : undefined}
                              aria-pressed={selected}
                              onClick={() => {
                                if (isAvailableDateOption(slot)) setBarberId(slot.barber_id);
                                setStartsAt(slot.starts_at);
                                holdRequestKeyRef.current = "";
                                setError("");
                              }}
                            >
                              <strong>{formatSlotTime(slot.starts_at, organization.timezone)}</strong>
                              {isAvailableDateOption(slot) && <span>{slot.barber_name}</span>}
                              {selected && <Check size={15} aria-hidden="true" />}
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>
            {barberMode === "ANY" && barber && startsAt && (
              <p className={styles.assignmentNotice} role="status"><Check size={18} aria-hidden="true" /> Seu atendimento será com <strong>{barber.name}</strong>.</p>
            )}
          </section>
        )}

        {step === 4 && choice && barber && startsAt && (
          <div className={styles.reviewGrid}>
            <aside className={styles.summary}>
              <span>Resumo do agendamento</span><h2>{choice.name}</h2>
              <dl><div><dt>Profissional</dt><dd>{barber.name}</dd></div><div><dt>Data e hora</dt><dd>{formatLocalDate(localDate)} · {formatSlotTime(startsAt, organization.timezone)}</dd></div><div><dt>Total</dt><dd>{formatMoney(choice.priceCents, organization.currency)}</dd></div><div className={styles.due}><dt>Pagar no atendimento</dt><dd>{formatMoney(choice.priceCents, organization.currency)}</dd></div></dl>
              <p>Sem pagamento antecipado neste momento.</p>
            </aside>
            <div className={styles.reviewMain}>
              {!user ? <AuthPrompt description="Entre com e-mail para identificar seu cadastro antes de confirmar." /> : (
                <>
                  <section className={styles.panel}>
                    <div className={styles.sectionTitle}><UserRound aria-hidden="true" /><div><h2>Seus dados</h2><p>Nome e contato vêm do seu perfil global.</p></div></div>
                    <p className={styles.customerDetails}>{customer?.full_name ?? "Cliente"}<span>{customer?.phone_e164 ?? "Contato não informado"}</span></p>
                  </section>
                  <p className={styles.holdNotice} role="timer" aria-live="polite"><Clock3 size={18} aria-hidden="true" /> Horário protegido por <strong>{countdownLabel(holdSeconds)}</strong>. Conclua antes do contador terminar.</p>
                  <section className={styles.panel}>
                    <div className={styles.sectionTitle}><CalendarDays aria-hidden="true" /><div><h2>Pagamento no atendimento</h2><p>O valor integral será pago diretamente à barbearia.</p></div></div>
                  </section>
                  <label className={styles.policy}><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /><span><ShieldCheck size={17} aria-hidden="true" /> Aceito a política desta reserva. Cancelamentos e alterações seguem o prazo informado pela barbearia.</span></label>
                  <p className={`${styles.whatsappPreference} ${whatsappAccepted ? "" : styles.whatsappPreferenceOff}`}><ShieldCheck size={17} aria-hidden="true" /> {whatsappAccepted ? "Mensagens de confirmação e lembrete pelo WhatsApp estão ativas. Você pode desativá-las no Perfil." : "Mensagens automáticas pelo WhatsApp estão desativadas no seu Perfil. A reserva continua disponível."}</p>
                </>
              )}
            </div>
          </div>
        )}

        {error && <div className={styles.errorBox} role="alert"><strong>Reserva não concluída</strong><span>{error}</span></div>}
      </div>

      <footer className={styles.bookingDialogFooter}>
        <span>{choice && <><small>{choice.name}</small><strong>{formatMoney(choice.priceCents, organization.currency)}</strong></>}</span>
        <div>
          {step === 1 ? (
            <Link href={exitHref} className={styles.secondaryButton}>Cancelar</Link>
          ) : (
            <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => void backFromCurrentStep()}>Voltar</button>
          )}
          {step < 4 ? (
            <button type="button" className={styles.primaryButton} disabled={!canContinue || busy} onClick={() => step === 3 ? void protectBookingForReview() : setStep((current) => current + 1)}>{busy && step === 3 ? <><LoaderCircle className={styles.spin} /> Protegendo…</> : "Continuar"}</button>
          ) : user ? (
            <button type="button" className={styles.primaryButton} disabled={busy || !accepted} onClick={() => void confirmBooking()}>{busy ? <><LoaderCircle className={styles.spin} /> Processando…</> : "Confirmar agendamento"}</button>
          ) : null}
        </div>
      </footer>
    </dialog>
  );
}
