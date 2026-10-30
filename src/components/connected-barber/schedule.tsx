"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Pencil, Plus, Trash2 } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { localDateTimeToIso } from "@/components/connected-manager/format";
import type { BarberAppContext } from "./types";
import styles from "./barber.module.css";

type Interval = { id: string; weekday: number; starts_at: string; ends_at: string; environment_id: string | null };
type Exception = { id: string; kind: "UNAVAILABLE" | "AVAILABLE_OVERRIDE"; service_period: string; reason: string | null };
type ChangeMessage = { id: string; message: string; created_at: string; details: { actor_role?: string } };
type ScheduleData = { barber_id: string; timezone: string; intervals: Interval[]; exceptions: Exception[]; messages: ChangeMessage[] };

const weekdays = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
const dateTimeDefault = (date: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
};
const displayPeriod = (period: string, timezone: string) => {
  const [start, end] = period.slice(1, -1).split(",").map((value) => new Date(value.trim().replace(/^"|"$/g, "")));
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "Período indisponível";
  const formatter = new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, dateStyle: "short", timeStyle: "short" });
  return `${formatter.format(start)} – ${formatter.format(end)}`;
};

export function BarberSchedule({ context }: { context: BarberAppContext }) {
  const router = useRouter();
  const [schedule, setSchedule] = useState<ScheduleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<Interval | null>(null);
  const [weekday, setWeekday] = useState("1");
  const [startsAt, setStartsAt] = useState("09:00");
  const [endsAt, setEndsAt] = useState("17:00");
  const [exceptionStart, setExceptionStart] = useState("");
  const [exceptionEnd, setExceptionEnd] = useState("");

  const query = useMemo(() => `?barbearia=${encodeURIComponent(context.organization_slug)}`, [context.organization_slug]);
  const load = useCallback(async (initializeDefaults = false) => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) { setMessage("Supabase indisponível."); setLoading(false); return; }
    const { data, error } = await supabase.rpc("get_my_barber_schedule", { p_organization_id: context.organization_id });
    if (error) setMessage(error.message);
    else if (data && typeof data === "object") {
      const result = data as ScheduleData;
      setSchedule(result);
      if (initializeDefaults) {
        const start = new Date(Date.now() + 60 * 60 * 1000);
        const end = new Date(Date.now() + 2 * 60 * 60 * 1000);
        setExceptionStart(dateTimeDefault(start, result.timezone));
        setExceptionEnd(dateTimeDefault(end, result.timezone));
      }
    }
    setLoading(false);
  }, [context.organization_id]);
  useEffect(() => { void Promise.resolve().then(() => load(true)); }, [load]);

  function beginEdit(item: Interval) {
    setEditing(item); setWeekday(String(item.weekday)); setStartsAt(item.starts_at.slice(0, 5)); setEndsAt(item.ends_at.slice(0, 5));
    document.getElementById("barber-schedule-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function mutate(action: string, input: Record<string, unknown> = {}) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) throw new Error("Supabase indisponível.");
    const { data, error } = await supabase.rpc("mutate_barber_schedule", { p_organization_id: context.organization_id, p_barber_id: context.barber_id, p_action: action, ...input });
    if (error) {
      if (/future appointments|cannot be changed|cannot be blocked|cannot be changed/i.test(error.message)) throw new Error("Há um atendimento agendado nesse horário. Reagende ou cancele antes de alterar a escala.");
      throw new Error(error.message);
    }
    const responseMessage = data && typeof data === "object" && "message" in data && typeof data.message === "string" ? data.message : "Alteração salva e registrada.";
    setMessage(responseMessage);
    await load();
    router.refresh();
  }

  async function saveInterval(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage("");
    try {
      await mutate(editing ? "UPDATE_INTERVAL" : "ADD_INTERVAL", {
        ...(editing ? { p_interval_id: editing.id } : {}),
        p_weekday: Number(weekday), p_starts_at: startsAt, p_ends_at: endsAt,
        p_environment_id: editing?.environment_id ?? null,
      });
      setEditing(null); setWeekday("1"); setStartsAt("09:00"); setEndsAt("17:00");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível salvar o horário."); }
    finally { setSaving(false); }
  }

  async function saveException(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage("");
    try {
      const start = localDateTimeToIso(exceptionStart, context.timezone);
      const end = localDateTimeToIso(exceptionEnd, context.timezone);
      await mutate("ADD_EXCEPTION", { p_exception_start: start, p_exception_end: end, p_reason: String(new FormData(event.currentTarget).get("reason") ?? "").trim() || null, p_exception_kind: "UNAVAILABLE" });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível registrar a folga."); }
    finally { setSaving(false); }
  }

  async function remove(action: "DELETE_INTERVAL" | "DELETE_EXCEPTION", id: string) {
    if (saving) return; setSaving(true); setMessage("");
    try { await mutate(action, action === "DELETE_INTERVAL" ? { p_interval_id: id } : { p_exception_id: id }); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível excluir o item."); }
    finally { setSaving(false); }
  }

  const intervals = schedule?.intervals ?? [];
  const exceptions = schedule?.exceptions ?? [];
  const changes = schedule?.messages ?? [];
  const backHref = `/barbeiro/perfil${query}`;
  return <><section className={styles.hero}><div><p className={styles.eyebrow}>{context.organization_name}</p><h1 className={styles.title}>Escala</h1><p className={styles.muted}>Gerencie seus horários recorrentes e folgas.</p><Link className={styles.switcher} href={backHref}>← Voltar para Meu</Link></div></section>
    {message && <p className={styles.notice} role="status">{message}</p>}
    {loading ? <section className={styles.card}>Carregando sua escala…</section> : <>
      <section className={styles.card}><h2>Horários semanais</h2><p className={styles.muted}>Horários com atendimentos agendados não podem ser editados ou removidos.</p>
        <div className={styles.list}>{weekdays.map((name, day) => { const items = intervals.filter((item) => item.weekday === day); return <article className={styles.scheduleDay} key={day}><strong>{name}</strong>{items.length ? items.map((item) => <div className={styles.row} key={item.id}><span>{item.starts_at.slice(0, 5)}–{item.ends_at.slice(0, 5)}</span><div className={styles.actions}><button className={`${styles.button} ${styles.secondary}`} type="button" disabled={saving} onClick={() => beginEdit(item)}><Pencil size={14} /> Editar</button><button className={`${styles.button} ${styles.dangerButton}`} type="button" disabled={saving} onClick={() => void remove("DELETE_INTERVAL", item.id)}><Trash2 size={14} /> Excluir</button></div></div>) : <small className={styles.muted}>Sem horário cadastrado</small>}</article>; })}</div>
      </section>
      <form id="barber-schedule-form" className={`${styles.card} ${styles.form}`} onSubmit={(event) => void saveInterval(event)}><h2>{editing ? "Editar horário" : "Adicionar horário"}</h2><div className={styles.scheduleFormGrid}><label>Dia da semana<select value={weekday} onChange={(event) => setWeekday(event.target.value)}>{weekdays.map((name, index) => <option value={index} key={name}>{name}</option>)}</select></label><label>Início<input type="time" required value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label><label>Fim<input type="time" required value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label></div><div className={styles.formActions}>{editing && <button className={`${styles.button} ${styles.secondary}`} type="button" onClick={() => setEditing(null)}>Cancelar edição</button>}<button className={styles.button} disabled={saving}><Plus size={15} /> {saving ? "Salvando…" : editing ? "Salvar horário" : "Adicionar horário"}</button></div></form>
      <form className={`${styles.card} ${styles.form}`} onSubmit={(event) => void saveException(event)}><h2>Adicionar folga ou exceção</h2><p className={styles.muted}>O período será bloqueado para novos atendimentos.</p><div className={styles.scheduleFormGrid}><label>Início<input type="datetime-local" required value={exceptionStart} onChange={(event) => setExceptionStart(event.target.value)} /></label><label>Fim<input type="datetime-local" required value={exceptionEnd} onChange={(event) => setExceptionEnd(event.target.value)} /></label><label className={styles.scheduleReason}>Motivo (opcional)<input name="reason" maxLength={240} /></label></div><div className={styles.formActions}><button className={styles.button} disabled={saving}><CalendarClock size={15} /> {saving ? "Salvando…" : "Registrar folga"}</button></div></form>
      <section className={styles.card}><h2>Folgas e exceções cadastradas</h2>{exceptions.length ? <div className={styles.list}>{exceptions.map((item) => <article className={styles.row} key={item.id}><span><strong>{displayPeriod(item.service_period, schedule?.timezone ?? context.timezone)}</strong><small>{item.reason || (item.kind === "UNAVAILABLE" ? "Indisponibilidade" : "Horário extra")}</small></span><button className={`${styles.button} ${styles.dangerButton}`} type="button" disabled={saving} onClick={() => void remove("DELETE_EXCEPTION", item.id)}><Trash2 size={14} /> Excluir</button></article>)}</div> : <p className={styles.muted}>Nenhuma folga futura cadastrada.</p>}</section>
      <section className={styles.card}><h2>Histórico de alterações</h2>{changes.length ? <div className={styles.list}>{changes.map((item) => <article className={styles.scheduleChange} key={item.id}><strong>{item.message}</strong><small>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short", timeZone: schedule?.timezone ?? context.timezone }).format(new Date(item.created_at))}</small></article>)}</div> : <p className={styles.muted}>As alterações salvas aparecerão aqui com o responsável.</p>}</section>
    </>}
  </>;
}
