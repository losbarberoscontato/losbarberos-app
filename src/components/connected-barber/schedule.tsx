"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { localDateTimeToIso } from "@/components/connected-manager/format";
import type { BarberAppContext } from "./types";
import styles from "./barber.module.css";

type Interval = { id: string; weekday: number; starts_at: string; ends_at: string; environment_id: string | null };
type Environment = { id: string; name: string; location_id: string };
type Exception = { id: string; kind: "UNAVAILABLE" | "AVAILABLE_OVERRIDE"; service_period: string; reason: string | null };
type ChangeMessage = { id: string; message: string; created_at: string; details: { actor_role?: string } };
type ScheduleData = { barber_id: string; timezone: string; intervals: Interval[]; environments: Environment[]; exceptions: Exception[]; messages: ChangeMessage[] };
export type ScheduleSection = "overview" | "folgas" | "historico" | "nova-folga";

const weekdays = [
  { day: 1, label: "Segunda-feira" }, { day: 2, label: "Terça-feira" },
  { day: 3, label: "Quarta-feira" }, { day: 4, label: "Quinta-feira" },
  { day: 5, label: "Sexta-feira" }, { day: 6, label: "Sábado" }, { day: 0, label: "Domingo" },
];

function dateTimeDefault(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

function displayPeriod(period: string, timezone: string) {
  const [start, end] = period.slice(1, -1).split(",").map((value) => new Date(value.trim().replace(/^"|"$/g, "")));
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "Período indisponível";
  const formatter = new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, dateStyle: "short", timeStyle: "short" });
  return `${formatter.format(start)} – ${formatter.format(end)}`;
}

export function BarberSchedule({ context, section = "overview" }: { context: BarberAppContext; section?: ScheduleSection }) {
  const router = useRouter();
  const [schedule, setSchedule] = useState<ScheduleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [expandedDay, setExpandedDay] = useState<number | null>(null);
  const [editorDay, setEditorDay] = useState<number | null>(null);
  const [editing, setEditing] = useState<Interval | null>(null);
  const [startsAt, setStartsAt] = useState("09:00");
  const [endsAt, setEndsAt] = useState("17:00");
  const [environmentId, setEnvironmentId] = useState("");
  const [exceptionStart, setExceptionStart] = useState("");
  const [exceptionEnd, setExceptionEnd] = useState("");

  const query = useMemo(() => `?barbearia=${encodeURIComponent(context.organization_slug)}`, [context.organization_slug]);
  const baseHref = `/barbeiro/escala${query}`;
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
        setEnvironmentId(result.environments[0]?.id ?? "");
      }
    }
    setLoading(false);
  }, [context.organization_id]);
  useEffect(() => { void Promise.resolve().then(() => load(true)); }, [load]);

  async function mutate(action: string, input: Record<string, unknown> = {}) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) throw new Error("Supabase indisponível.");
    const { data, error } = await supabase.rpc("mutate_barber_schedule", { p_organization_id: context.organization_id, p_barber_id: context.barber_id, p_action: action, ...input });
    if (error) {
      if (/future appointments|cannot be changed|cannot be blocked/i.test(error.message)) throw new Error("Há um atendimento agendado nesse horário. Reagende ou cancele antes de alterar a escala.");
      if (/no active agenda environment|select an active agenda environment/i.test(error.message)) throw new Error("Escolha um ambiente disponível para esse horário.");
      throw new Error(error.message);
    }
    const responseMessage = data && typeof data === "object" && "message" in data && typeof data.message === "string" ? data.message : "Alteração salva e registrada.";
    setMessage(responseMessage);
    await load();
    router.refresh();
  }

  function openAdd(day: number) {
    setEditing(null);
    setEditorDay(day);
    setStartsAt("09:00");
    setEndsAt("17:00");
    setEnvironmentId(schedule?.environments[0]?.id ?? "");
  }

  function openEdit(item: Interval) {
    setEditing(item);
    setEditorDay(item.weekday);
    setExpandedDay(item.weekday);
    setStartsAt(item.starts_at.slice(0, 5));
    setEndsAt(item.ends_at.slice(0, 5));
    setEnvironmentId(item.environment_id ?? "");
  }

  async function saveInterval(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editorDay === null) return;
    setSaving(true);
    setMessage("");
    try {
      await mutate(editing ? "UPDATE_INTERVAL" : "ADD_INTERVAL", {
        ...(editing ? { p_interval_id: editing.id } : {}),
        p_weekday: editorDay,
        p_starts_at: startsAt,
        p_ends_at: endsAt,
        p_environment_id: environmentId || null,
      });
      setEditing(null);
      setEditorDay(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível salvar o horário.");
    } finally {
      setSaving(false);
    }
  }

  async function saveException(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setMessage("");
    try {
      await mutate("ADD_EXCEPTION", {
        p_exception_start: localDateTimeToIso(exceptionStart, context.timezone),
        p_exception_end: localDateTimeToIso(exceptionEnd, context.timezone),
        p_reason: String(form.get("reason") ?? "").trim() || null,
        p_exception_kind: "UNAVAILABLE",
      });
      router.push(`${baseHref}/folgas`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível registrar a folga.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(action: "DELETE_INTERVAL" | "DELETE_EXCEPTION", id: string) {
    if (saving) return;
    setSaving(true);
    setMessage("");
    try {
      await mutate(action, action === "DELETE_INTERVAL" ? { p_interval_id: id } : { p_exception_id: id });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível excluir o item.");
    } finally {
      setSaving(false);
    }
  }

  const intervals = schedule?.intervals ?? [];
  const environments = schedule?.environments ?? [];
  const exceptions = schedule?.exceptions ?? [];
  const changes = schedule?.messages ?? [];
  const pageTitle = section === "folgas" ? "Folgas e exceções" : section === "historico" ? "Histórico da escala" : section === "nova-folga" ? "Adicionar folga ou exceção" : "Escala";
  const backHref = section === "overview" ? `/barbeiro/perfil${query}` : baseHref;
  const headerText = section === "overview" ? "Gerencie seus horários recorrentes e folgas." : section === "nova-folga" ? "Informe o período que ficará indisponível para novos atendimentos." : "Consulte as alterações e folgas da sua escala.";

  return <>
    <section className={styles.hero}>
      <div>
        <p className={styles.eyebrow}>{context.organization_name}</p>
        <h1 className={styles.title}>{pageTitle}</h1>
        <p className={styles.muted}>{headerText}</p>
        <Link className={styles.switcher} href={backHref}>{section === "overview" ? "← Voltar para Meu" : "← Voltar para Escala"}</Link>
      </div>
    </section>
    {message && <p className={styles.notice} role="status">{message}</p>}
    {loading ? <section className={styles.card}>Carregando sua escala…</section> : <>
      {section === "overview" && <>
        <section className={styles.card}>
          <h2>Horários semanais</h2>
          <p className={styles.muted}>Horários com atendimentos agendados não podem ser editados ou removidos.</p>
          <div className={styles.scheduleAccordion}>
            {weekdays.map(({ day, label }) => {
              const items = intervals.filter((item) => item.weekday === day).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
              const expanded = expandedDay === day;
              return <article className={styles.scheduleAccordionItem} key={day}>
                <button type="button" className={styles.scheduleAccordionTrigger} aria-expanded={expanded} onClick={() => { setExpandedDay(expanded ? null : day); setEditorDay(null); setEditing(null); }}>
                  <span><strong>{label}</strong><small>{items.length ? `${items.length} ${items.length === 1 ? "horário" : "horários"}` : "Sem horário cadastrado"}</small></span>
                  <ChevronRight size={20} aria-hidden="true" />
                </button>
                {expanded && <div className={styles.scheduleAccordionBody}>
                  {items.length ? <div className={styles.list}>{items.map((item) => {
                    const environment = environments.find((entry) => entry.id === item.environment_id);
                    return <article className={styles.scheduleInterval} key={item.id}>
                      <span><strong>{item.starts_at.slice(0, 5)}–{item.ends_at.slice(0, 5)}</strong><small>Ambiente: {environment?.name ?? "Não identificado"}</small></span>
                      <div className={styles.actions}>
                        <button className={`${styles.button} ${styles.secondary}`} type="button" disabled={saving} onClick={() => openEdit(item)}><Pencil size={14} /> Editar</button>
                        <button className={`${styles.button} ${styles.dangerButton}`} type="button" disabled={saving} onClick={() => void remove("DELETE_INTERVAL", item.id)}><Trash2 size={14} /> Remover</button>
                      </div>
                    </article>;
                  })}</div> : <p className={styles.muted}>Nenhum horário cadastrado para este dia.</p>}
                  {editorDay === day ? <form className={`${styles.scheduleIntervalForm} ${styles.form}`} onSubmit={(event) => void saveInterval(event)}>
                    <h3>{editing ? "Editar horário" : `Adicionar horário · ${label}`}</h3>
                    <div className={styles.scheduleFormGrid}>
                      <label>Início<input type="time" required value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label>
                      <label>Fim<input type="time" required value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label>
                      <label>Ambiente<select required value={environmentId} onChange={(event) => setEnvironmentId(event.target.value)}><option value="">Selecione</option>{environments.map((environment) => <option value={environment.id} key={environment.id}>{environment.name}</option>)}</select></label>
                    </div>
                    {!environments.length && <p className={styles.muted}>Não há ambientes ativos disponíveis para esta unidade.</p>}
                    <div className={styles.formActions}>
                      <button className={`${styles.button} ${styles.secondary}`} type="button" onClick={() => { setEditorDay(null); setEditing(null); }}>Cancelar</button>
                      <button className={styles.button} disabled={saving || !environments.length || !environmentId}>{saving ? "Salvando…" : editing ? "Salvar alterações" : "Adicionar horário"}</button>
                    </div>
                  </form> : <button className={`${styles.button} ${styles.secondary} ${styles.scheduleAddButton}`} type="button" onClick={() => openAdd(day)}><Plus size={15} /> Adicionar horário</button>}
                </div>}
              </article>;
            })}
          </div>
        </section>
        <div className={styles.scheduleShortcuts}>
          <Link className={`${styles.card} ${styles.scheduleShortcut}`} href={`${baseHref}/nova-folga`}><span><CalendarClock size={19} /><strong>Adicionar folga ou exceção</strong><small>Cadastrar uma data e horário indisponível</small></span><ChevronRight size={19} /></Link>
          <Link className={`${styles.card} ${styles.scheduleShortcut}`} href={`${baseHref}/folgas`}><span><CalendarClock size={19} /><strong>Folgas e exceções cadastradas</strong><small>{exceptions.length ? `${exceptions.length} cadastradas` : "Consultar e remover períodos"}</small></span><ChevronRight size={19} /></Link>
          <Link className={`${styles.card} ${styles.scheduleShortcut}`} href={`${baseHref}/historico`}><span><CalendarClock size={19} /><strong>Histórico de alterações</strong><small>Ver quem alterou a escala e quando</small></span><ChevronRight size={19} /></Link>
        </div>
      </>}

      {section === "nova-folga" && <form className={`${styles.card} ${styles.form}`} onSubmit={(event) => void saveException(event)}>
        <div className={styles.scheduleFormGrid}>
          <label>Início<input type="datetime-local" required value={exceptionStart} onChange={(event) => setExceptionStart(event.target.value)} /></label>
          <label>Fim<input type="datetime-local" required value={exceptionEnd} onChange={(event) => setExceptionEnd(event.target.value)} /></label>
          <label className={styles.scheduleReason}>Motivo (opcional)<input name="reason" maxLength={240} /></label>
        </div>
        <div className={styles.formActions}><button className={styles.button} disabled={saving}><CalendarClock size={15} /> {saving ? "Salvando…" : "Salvar folga ou exceção"}</button></div>
      </form>}

      {section === "folgas" && <section className={styles.card}>
        <h2>Folgas e exceções cadastradas</h2>
        {exceptions.length ? <div className={styles.list}>{exceptions.map((item) => <article className={styles.row} key={item.id}><span><strong>{displayPeriod(item.service_period, schedule?.timezone ?? context.timezone)}</strong><small>{item.reason || (item.kind === "UNAVAILABLE" ? "Indisponibilidade" : "Horário especial")}</small></span><button className={`${styles.button} ${styles.dangerButton}`} type="button" disabled={saving} onClick={() => void remove("DELETE_EXCEPTION", item.id)}><Trash2 size={14} /> Remover</button></article>)}</div> : <p className={styles.muted}>Nenhuma folga futura cadastrada.</p>}
      </section>}

      {section === "historico" && <section className={styles.card}>
        <h2>Alterações recentes</h2>
        {changes.length ? <div className={styles.list}>{changes.map((item) => <article className={styles.scheduleChange} key={item.id}><strong>{item.message}</strong><small>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short", timeZone: schedule?.timezone ?? context.timezone }).format(new Date(item.created_at))}</small></article>)}</div> : <p className={styles.muted}>As alterações salvas aparecerão aqui com o responsável.</p>}
      </section>}
    </>}
  </>;
}
