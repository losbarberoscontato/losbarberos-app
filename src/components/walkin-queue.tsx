"use client";

import { Clock3, LoaderCircle, Scissors } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createWalkinQueueHold, getWalkinQueueAvailability, type WalkinQueueAvailability } from "@/components/connected-client/api";
import { formatSlotTime } from "@/components/connected-client/format";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

const holdStorageKey = "los-barberos:walkin-queue-hold";
type WalkinSlot = WalkinQueueAvailability["slots"][number];

const queuePeriods = [
  { label: "Matutino", startHour: 0, endHour: 12 },
  { label: "Vespertino", startHour: 12, endHour: 18 },
  { label: "Noturno", startHour: 18, endHour: 24 },
] as const;

export function groupWalkinSlots(slots: readonly WalkinSlot[], timezone: string) {
  return queuePeriods.map((period) => ({
    ...period,
    slots: slots.filter((slot) => {
      const hour = Number(formatSlotTime(slot.starts_at, timezone).slice(0, 2));
      return hour >= period.startHour && hour < period.endHour;
    }),
  }));
}

export function WalkinQueue({ queuePublicId }: { queuePublicId: string }) {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [data, setData] = useState<WalkinQueueAvailability | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [selectedBarberId, setSelectedBarberId] = useState("ALL");

  useEffect(() => {
    if (!supabase) return;
    void getWalkinQueueAvailability(supabase, queuePublicId)
      .then(setData)
      .catch(() => setError("Agenda indisponível. Tente novamente."));
  }, [queuePublicId, supabase]);

  async function reserve(slot: WalkinSlot) {
    if (!supabase || !data) return;
    setBusy(`${slot.barber_id}:${slot.starts_at}`);
    try {
      const hold = await createWalkinQueueHold(supabase, { queuePublicId, barberId: slot.barber_id, startsAt: slot.starts_at });
      window.sessionStorage.setItem(holdStorageKey, JSON.stringify({ id: hold.hold_id, expiresAt: hold.expires_at }));
      const target = new URLSearchParams({ barbeiro: slot.barber_id, horario: slot.starts_at });
      const next = `/cliente/agendar?${target.toString()}`;
      router.push(`/cliente/entrar?barbearia=${encodeURIComponent(data.organization.slug)}&next=${encodeURIComponent(next)}`);
    } catch {
      setError("Esse horário acabou de ser ocupado. Atualize a agenda.");
    } finally {
      setBusy("");
    }
  }

  if (!supabase) return <main className="login-page"><p>Fila presencial disponível somente no ambiente conectado.</p></main>;
  if (!data && !error) return <main className="login-page"><p><LoaderCircle /> Carregando agenda…</p></main>;
  if (!data) return <main className="login-page"><p>{error}</p></main>;

  const barbers = [...data.slots.reduce((options, slot) => {
    if (!options.has(slot.barber_id)) options.set(slot.barber_id, { id: slot.barber_id, name: slot.barber_name, nextSlot: slot });
    return options;
  }, new Map<string, { id: string; name: string; nextSlot: WalkinSlot }>()).values()];
  const visibleSlots = selectedBarberId === "ALL" ? data.slots : data.slots.filter((slot) => slot.barber_id === selectedBarberId);
  const nextSlots = barbers.map((barber) => barber.nextSlot);
  const periods = groupWalkinSlots(visibleSlots, data.organization.timezone);

  return <main className="walkin-queue">
    <section className="walkin-queue__content">
      <header className="walkin-queue__header">
        <span className="hero-pill"><Scissors size={15} /> Fila presencial</span>
        <h1>{data.organization.name}</h1>
        <p>Escolha uma vaga livre. Ela fica reservada por 10 minutos enquanto você entra.</p>
      </header>
      {error && <p className="walkin-queue__error" role="alert">{error}</p>}
      {nextSlots.length > 0 && <section className="walkin-queue__next-section" aria-labelledby="walkin-next-title">
        <div className="walkin-queue__next-heading"><span>Disponibilidade imediata</span><h2 id="walkin-next-title">Próximas vagas por barbeiro</h2></div>
        <div className="walkin-queue__next-grid">{nextSlots.map((slot) => <article className="walkin-queue__next" key={slot.barber_id}>
          <div><span>Próxima vaga</span><strong>{formatSlotTime(slot.starts_at, data.organization.timezone)}</strong><p>{slot.barber_name}</p></div>
          <button className="button button--dark" onClick={() => void reserve(slot)} disabled={Boolean(busy)}>Agendar agora</button>
        </article>)}</div>
      </section>}
      <section className="walkin-queue__availability" aria-labelledby="walkin-slots-title">
        <div className="walkin-queue__section-head"><div><span>Agenda de hoje</span><h2 id="walkin-slots-title">Vagas disponíveis</h2></div><p>{visibleSlots.length} {visibleSlots.length === 1 ? "horário livre" : "horários livres"}</p></div>
        <div className="walkin-queue__barber-filter" role="group" aria-label="Filtrar horários por barbeiro">
          <button type="button" className={selectedBarberId === "ALL" ? "is-selected" : ""} onClick={() => setSelectedBarberId("ALL")}>Todos</button>
          {barbers.map((barber) => <button type="button" className={selectedBarberId === barber.id ? "is-selected" : ""} key={barber.id} onClick={() => setSelectedBarberId(barber.id)}>{barber.name}</button>)}
        </div>
        {visibleSlots.length ? <div className="walkin-queue__periods">
          {periods.map((period) => <section className="walkin-queue__period" key={period.label} aria-label={`Período ${period.label}`}>
            <header><h3>{period.label}</h3><span>{period.slots.length}</span></header>
            {period.slots.length ? <div className="walkin-queue__slot-list">{period.slots.map((slot) => <button className="walkin-queue__slot" key={`${slot.barber_id}:${slot.starts_at}`} onClick={() => void reserve(slot)} disabled={Boolean(busy)} aria-label={`Agendar às ${formatSlotTime(slot.starts_at, data.organization.timezone)} com ${slot.barber_name}`}>
              <Clock3 size={17} /><span><strong>{formatSlotTime(slot.starts_at, data.organization.timezone)}</strong><small>{slot.barber_name}</small></span>
            </button>)}</div> : <p className="walkin-queue__empty-period">Sem vagas neste período.</p>}
          </section>)}
        </div> : <p className="walkin-queue__empty">Não há mais vagas hoje.</p>}
      </section>
    </section>
  </main>;
}

export { holdStorageKey };
