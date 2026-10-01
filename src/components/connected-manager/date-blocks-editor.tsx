"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { assertResult, connectedClient, runMutation } from "./mutation-utils";
import { buildYearCalendar, dateBlockCoversDate, dateKey, type DateBlockType, type OrganizationDateBlock } from "./date-block-calendar";
import styles from "./date-blocks-editor.module.css";

type Props = { organizationId: string; timezone: string; blocks: OrganizationDateBlock[]; onClose(): void };
type HolidayScope = NonNullable<OrganizationDateBlock["holiday_scope"]>;
type Recurrence = NonNullable<OrganizationDateBlock["recurrence"]>;

function todayYear(timezone: string) {
  return Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: timezone }).format(new Date()));
}

function displayDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function label(block: OrganizationDateBlock) {
  return block.block_type === "HOLIDAY" ? `Feriado · ${block.name}` : block.block_type === "RECESS" ? `Recesso · ${block.name}` : `Evento · ${block.name}`;
}

export function DateBlocksEditor({ organizationId, timezone, blocks, onClose }: Props) {
  const router = useRouter();
  const [year, setYear] = useState(() => todayYear(timezone));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [editing, setEditing] = useState<OrganizationDateBlock | null>(null);
  const [type, setType] = useState<DateBlockType>("HOLIDAY");
  const [message, setMessage] = useState("");
  const months = useMemo(() => buildYearCalendar(year), [year]);

  function chooseDate(date: string) {
    const block = blocks.find((item) => dateBlockCoversDate(item, date)) ?? null;
    setSelectedDate(date);
    setEditing(block);
    setType(block?.block_type ?? "HOLIDAY");
    setMessage("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDate) return;
    const data = new FormData(event.currentTarget);
    const blockType = editing?.block_type ?? type;
    const startDate = blockType === "RECESS" ? String(data.get("start_date") ?? selectedDate) : blockType === "HOLIDAY" && editing ? editing.start_date : selectedDate;
    const endDate = blockType === "RECESS" ? String(data.get("end_date") ?? selectedDate) : null;
    const recurrence = blockType === "HOLIDAY" ? String(data.get("recurrence") ?? "YEAR") as Recurrence : null;
    const result = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("save_organization_date_block", {
        p_organization_id: organizationId,
        p_id: editing?.id ?? null,
        p_block_type: blockType,
        p_name: String(data.get("name") ?? "").trim(),
        p_description: String(data.get("description") ?? "").trim() || null,
        p_holiday_scope: blockType === "HOLIDAY" ? String(data.get("holiday_scope") ?? "FEDERAL") as HolidayScope : null,
        p_recurrence: recurrence,
        p_start_date: startDate,
        p_end_date: endDate,
        p_start_time: blockType === "EVENT" ? String(data.get("start_time") ?? "") : null,
        p_end_time: blockType === "EVENT" ? String(data.get("end_time") ?? "") : null,
      }));
    }, "Bloqueio salvo.");
    if (result) { setSelectedDate(null); router.refresh(); }
  }

  async function remove() {
    if (!editing) return;
    const result = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("delete_organization_date_block", { p_organization_id: organizationId, p_id: editing.id }));
    }, "Bloqueio excluído.");
    if (result) { setSelectedDate(null); router.refresh(); }
  }

  return <div className={styles.backdrop} role="presentation">
    <button className={styles.dismiss} type="button" aria-label="Fechar bloqueio de datas" onClick={onClose} />
    <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="date-block-title">
      <header className={styles.header}>
        <span><small>Regras de negócio</small><strong id="date-block-title">Bloqueio de Datas</strong></span>
        <div className={styles.yearNav} aria-label="Navegar entre anos">
          <button type="button" aria-label="Ano anterior" disabled={year <= 1} onClick={() => setYear((value) => value - 1)}><ChevronLeft size={18} /></button>
          <strong>{year}</strong>
          <button type="button" aria-label="Próximo ano" disabled={year >= 9999} onClick={() => setYear((value) => value + 1)}><ChevronRight size={18} /></button>
        </div>
        <button className={styles.close} type="button" aria-label="Fechar" onClick={onClose}><X size={20} /></button>
      </header>
      <div className={styles.legend}>
        <span><i className={styles.holidayDot} /> Feriado</span><span><i className={styles.recessDot} /> Recesso</span><span><i className={styles.eventDot} /> Evento</span>
      </div>
      <div className={styles.calendar}>
        {months.map((month) => <section className={styles.month} key={month.month}>
          <h3>{month.label} / {year}</h3>
          <div className={styles.weekdays}>{month.weekdayLabels.map((day) => <span key={day}>{day}</span>)}</div>
          <div className={styles.days}>
            {Array.from({ length: month.leadingEmptyDays }, (_, i) => <span className={styles.empty} key={`empty-${i}`} />)}
            {month.days.map((day) => {
              const key = dateKey(year, month.month, day);
              const block = blocks.find((item) => dateBlockCoversDate(item, key));
              const category = block?.block_type.toLowerCase();
              return <button key={key} type="button" className={`${styles.day} ${category ? styles[category] : ""} ${selectedDate === key ? styles.selected : ""}`} title={block ? label(block) : displayDate(key)} aria-label={`${displayDate(key)}${block ? `, ${label(block)}` : ""}`} onClick={() => chooseDate(key)}>
                {day}{block && <i aria-hidden="true" />}
              </button>;
            })}
          </div>
        </section>)}
      </div>
      <footer className={styles.footer}><span>{message}</span><button type="button" className="button button--soft" onClick={onClose}>Concluir</button></footer>
      {selectedDate && <div className={styles.formBackdrop} role="presentation">
        <button className={styles.formDismiss} type="button" aria-label="Fechar edição do bloqueio" onClick={() => setSelectedDate(null)} />
        <form className={styles.form} role="dialog" aria-modal="true" aria-labelledby="date-block-form-title" onSubmit={(event) => void save(event)}>
          <header className={styles.formHeader}><span><small>{displayDate(selectedDate)}</small><strong id="date-block-form-title">{editing ? "Editar bloqueio" : "Adicionar bloqueio"}</strong></span><button type="button" className={styles.close} aria-label="Fechar" onClick={() => setSelectedDate(null)}><X size={20} /></button></header>
          {!editing && <div className={styles.typeChoices} aria-label="Tipo de bloqueio">{(["HOLIDAY", "RECESS", "EVENT"] as const).map((value) => <button type="button" key={value} aria-pressed={type === value} onClick={() => setType(value)}>{value === "HOLIDAY" ? "Feriado" : value === "RECESS" ? "Recesso" : "Evento"}</button>)}</div>}
          <div className={styles.formBody}>
            <label>Nome{type === "HOLIDAY" ? " do feriado" : type === "RECESS" ? " do recesso" : " do evento"}<input name="name" required maxLength={160} defaultValue={editing?.name ?? ""} key={`${editing?.id ?? "new"}-${selectedDate}-name`} /></label>
            {type === "HOLIDAY" && <>
              <label>Abrangência<select name="holiday_scope" defaultValue={editing?.holiday_scope ?? "FEDERAL"}><option value="MUNICIPAL">Municipal</option><option value="STATE">Estadual</option><option value="FEDERAL">Federal</option></select></label>
              <label>Tipo de feriado<select name="recurrence" defaultValue={editing?.recurrence ?? "YEAR"}><option value="ANNUAL">Permanente · repete todo ano</option><option value="YEAR">Móvel · somente {year}</option></select></label>
            </>}
            {type === "RECESS" && <div className={styles.range}>
              <label>Primeiro dia<input name="start_date" type="date" required defaultValue={editing?.start_date ?? selectedDate} /></label>
              <label>Último dia<input name="end_date" type="date" min={editing?.start_date ?? selectedDate} required defaultValue={editing?.end_date ?? selectedDate} /></label>
            </div>}
            {type === "EVENT" && <>
              <div className={styles.range}><label>Hora de início<input name="start_time" type="time" required defaultValue={editing?.start_time?.slice(0, 5) ?? "09:00"} /></label><label>Hora de fim<input name="end_time" type="time" required defaultValue={editing?.end_time?.slice(0, 5) ?? "10:00"} /></label></div>
              <label>Descrição<textarea name="description" rows={3} defaultValue={editing?.description ?? ""} /></label>
            </>}
          </div>
          <footer className={styles.formFooter}>
            {message && <p role="status">{message.includes("organization_date_block_conflict") ? "Há agendamento ativo neste período. Reagende ou cancele antes de bloquear." : message.includes("date block overlaps") ? "Este período já tem outro bloqueio cadastrado." : message}</p>}
            {editing && <button type="button" className="button button--danger" onClick={() => void remove()}>Excluir bloqueio</button>}
            <button type="button" className="button button--soft" onClick={() => setSelectedDate(null)}>Cancelar</button>
            <button type="submit" className="button">Salvar</button>
          </footer>
        </form>
      </div>}
    </section>
  </div>;
}
