"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { normalizePhoneE164 } from "@/lib/phone";
import type { loadTeamData } from "./server";
import type { AwaitedReturn } from "./utility-types";
import type { BarberRecord } from "./types";
import { centsFromInput, formatCents, formatRange, initials, toPostgresRange, weekDays } from "./format";
import { ActionMessage, EmptyState, Field, Panel, StatusChip } from "./shared";
import { assertResult, connectedClient, runMutation } from "./mutation-utils";
import styles from "./connected-manager.module.css";

type Props = AwaitedReturn<typeof loadTeamData>;

export function TeamManager(props: Props) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [barberForm, setBarberForm] = useState<BarberRecord | "new" | null>(props.barbers.length ? null : "new");
  const [scheduleBarber, setScheduleBarber] = useState(props.barbers.find((item) => item.active)?.id ?? "");
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [showExceptionForm, setShowExceptionForm] = useState(false);
  const [showCommissionForm, setShowCommissionForm] = useState(false);
  const activeLocation = props.locations.find((location) => location.active);
  const serviceById = useMemo(() => new Map(props.services.map((service) => [service.id, service])), [props.services]);
  const selectedBarber = props.barbers.find((barber) => barber.id === scheduleBarber);

  async function saveBarber(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const editing = barberForm !== "new" && barberForm;
    const rawWhatsapp = String(data.get("whatsapp_e164") ?? "").trim();
    const whatsappE164 = normalizePhoneE164(rawWhatsapp);
    const payload = {
      organization_id: props.organizationId,
      location_id: String(data.get("location_id") || activeLocation?.id || ""),
      display_name: String(data.get("display_name") ?? "").trim(),
      bio: String(data.get("bio") ?? "").trim() || null,
      whatsapp_e164: whatsappE164,
    };
    const saved = await runMutation(setMessage, async () => {
      if (!payload.location_id) throw new Error("Cadastre uma unidade ativa antes da equipe.");
      if (rawWhatsapp && !whatsappE164) throw new Error("Informe um WhatsApp válido para o profissional.");
      const client = connectedClient();
      await assertResult(editing
        ? await client.from("barbers").update(payload).eq("id", editing.id).eq("organization_id", props.organizationId)
        : await client.from("barbers").insert(payload));
    }, editing ? "Profissional atualizado." : "Profissional cadastrado.");
    if (saved) { setBarberForm(null); router.refresh(); }
  }

  async function toggleBarber(barber: BarberRecord) {
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().from("barbers").update({ active: !barber.active }).eq("id", barber.id).eq("organization_id", props.organizationId));
    }, barber.active ? "Profissional inativado." : "Profissional reativado.");
    if (saved) router.refresh();
  }

  async function toggleSkill(barberId: string, serviceId: string, active: boolean) {
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().from("barber_services").upsert({ organization_id: props.organizationId, barber_id: barberId, service_id: serviceId, active }, { onConflict: "barber_id,service_id" }));
    }, "Competências atualizadas.");
    if (saved) router.refresh();
  }

  async function addInterval(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const saved = await runMutation(setMessage, async () => {
      if (!scheduleBarber) throw new Error("Selecione um profissional.");
      await assertResult(await connectedClient().from("work_intervals").insert({
        organization_id: props.organizationId,
        barber_id: scheduleBarber,
        weekday: Number(data.get("weekday")),
        starts_at: String(data.get("starts_at")),
        ends_at: String(data.get("ends_at")),
      }));
    }, "Intervalo adicionado.");
    if (saved) { setShowScheduleForm(false); router.refresh(); }
  }

  async function removeInterval(id: string) {
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().from("work_intervals").delete().eq("id", id).eq("organization_id", props.organizationId));
    }, "Intervalo removido.");
    if (saved) router.refresh();
  }

  async function addException(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const saved = await runMutation(setMessage, async () => {
      if (!scheduleBarber) throw new Error("Selecione um profissional.");
      await assertResult(await connectedClient().from("availability_exceptions").insert({
        organization_id: props.organizationId,
        barber_id: scheduleBarber,
        kind: String(data.get("kind")),
        service_period: toPostgresRange(String(data.get("start")), String(data.get("end")), props.timezone),
        reason: String(data.get("reason") ?? "").trim() || null,
      }));
    }, "Exceção adicionada.");
    if (saved) { setShowExceptionForm(false); router.refresh(); }
  }

  async function removeException(id: string) {
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().from("availability_exceptions").delete().eq("id", id).eq("organization_id", props.organizationId));
    }, "Exceção removida.");
    if (saved) router.refresh();
  }

  async function addCommissionRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const mode = String(data.get("mode")) as "PERCENT" | "FIXED";
    const serviceId = String(data.get("service_id") || "") || null;
    const saved = await runMutation(setMessage, async () => {
      if (!scheduleBarber) throw new Error("Selecione um profissional.");
      const currentRule = props.commissionRules.find((rule) =>
        rule.active && rule.barber_id === scheduleBarber && rule.service_id === serviceId
      );
      await assertResult(await connectedClient().rpc("replace_commission_rule", {
        p_organization_id: props.organizationId,
        p_barber_id: scheduleBarber,
        p_service_id: serviceId,
        p_mode: mode,
        p_percentage_bps: mode === "PERCENT" ? Math.round(Number(data.get("value")) * 100) : null,
        p_fixed_cents: mode === "FIXED" ? centsFromInput(data.get("value")) : null,
        p_effective_at: new Date().toISOString(),
        p_current_rule_id: currentRule?.id ?? null,
      }));
    }, "Nova versão de comissão criada.");
    if (saved) { setShowCommissionForm(false); router.refresh(); }
  }

  const intervals = props.workIntervals.filter((item) => item.barber_id === scheduleBarber && item.active);
  const exceptions = props.exceptions.filter((item) => item.barber_id === scheduleBarber);
  const rules = props.commissionRules.filter((item) => item.barber_id === scheduleBarber && item.active);

  return <div className={styles.stack}>
    <PageHeader title="Equipe" description="Profissionais, competências, escalas, folgas e regras versionadas." />
    <ActionMessage message={message} />
    <Panel title="Profissionais" description={`${props.barbers.filter((item) => item.active).length} ativos`} action={<button className={styles.button} type="button" onClick={() => setBarberForm("new")}>Novo profissional</button>}>
      {barberForm && <form className={styles.form} onSubmit={saveBarber} key={barberForm === "new" ? "new" : barberForm.id}>
        <Field label="Nome"><input name="display_name" required minLength={2} defaultValue={barberForm === "new" ? "" : barberForm.display_name} /></Field>
        <Field label="Unidade"><select name="location_id" required defaultValue={barberForm === "new" ? activeLocation?.id : barberForm.location_id}>{props.locations.filter((item) => item.active).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></Field>
        <Field label="WhatsApp do profissional"><><input name="whatsapp_e164" inputMode="tel" required placeholder="47999999999 ou +5547999999999" pattern="[+0-9][0-9\s().-]{7,20}" defaultValue={barberForm === "new" ? "" : barberForm.whatsapp_e164 ?? ""} onBlur={(event) => { const normalized = normalizePhoneE164(event.currentTarget.value); if (normalized) event.currentTarget.value = normalized; }} /><small className={styles.muted}>Usado somente para avisos transacionais dos próprios agendamentos.</small></></Field>
        <Field label="Apresentação" wide><textarea name="bio" defaultValue={barberForm === "new" ? "" : barberForm.bio ?? ""} /></Field>
        <div className={`${styles.toolbarGroup} ${styles.formWide}`}><button className={styles.button} type="submit">Salvar</button><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => setBarberForm(null)}>Cancelar</button></div>
      </form>}
      {props.barbers.length === 0 ? <EmptyState title="Cadastre a equipe">A unidade precisa de pelo menos um profissional para abrir a agenda.</EmptyState> : <div className={styles.cards}>{props.barbers.map((barber) => {
        const skills = props.barberServices.filter((link) => link.barber_id === barber.id && link.active);
        return <article className={styles.card} key={barber.id}><div className={styles.cardTop}><span className={styles.toolbarGroup}><i className={styles.avatar}>{initials(barber.display_name)}</i><span className={styles.rowTitle}><strong>{barber.display_name}</strong><small>{barber.bio ?? "Sem apresentação"}</small><small>{barber.whatsapp_e164 ? `WhatsApp: ${barber.whatsapp_e164}` : "WhatsApp não cadastrado"}</small></span></span><StatusChip active={barber.active} /></div>
          <div><span className={styles.muted}>Competências</span><div className={styles.inlineMeta}>{props.services.map((service) => { const checked = skills.some((link) => link.service_id === service.id); return <label className={styles.check} key={service.id}><input type="checkbox" checked={checked} onChange={(event) => toggleSkill(barber.id, service.id, event.target.checked)} />{service.name}</label>; })}</div></div>
          <div className={styles.rowActions}><button className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} type="button" onClick={() => { setScheduleBarber(barber.id); document.getElementById("team-operation")?.scrollIntoView({ behavior: "smooth" }); }}>Escala e comissão</button><button className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} type="button" onClick={() => setBarberForm(barber)}>Editar</button><button className={`${styles.button} ${barber.active ? styles.buttonDanger : styles.buttonSoft} ${styles.buttonSmall}`} type="button" onClick={() => toggleBarber(barber)}>{barber.active ? "Inativar" : "Reativar"}</button></div>
        </article>;
      })}</div>}
    </Panel>

    <Panel title="Escala, exceções e comissão" description={selectedBarber ? `Configuração de ${selectedBarber.display_name}` : "Selecione um profissional"}>
      <div className={styles.toolbar} id="team-operation"><label className={styles.field}><span>Profissional</span><select value={scheduleBarber} onChange={(event) => setScheduleBarber(event.target.value)}><option value="">Selecione</option>{props.barbers.map((barber) => <option key={barber.id} value={barber.id}>{barber.display_name}</option>)}</select></label><div className={styles.toolbarGroup}><button className={`${styles.button} ${styles.buttonSoft}`} type="button" disabled={!scheduleBarber} onClick={() => setShowScheduleForm((value) => !value)}>Adicionar horário</button><button className={`${styles.button} ${styles.buttonSoft}`} type="button" disabled={!scheduleBarber} onClick={() => setShowExceptionForm((value) => !value)}>Adicionar folga/exceção</button><button className={styles.button} type="button" disabled={!scheduleBarber} onClick={() => setShowCommissionForm((value) => !value)}>Nova comissão</button></div></div>
      {showScheduleForm && <form className={styles.form} onSubmit={addInterval}><Field label="Dia"><select name="weekday">{weekDays.map((day, index) => <option value={index} key={day}>{day}</option>)}</select></Field><Field label="Início"><input type="time" name="starts_at" required defaultValue="09:00" /></Field><Field label="Fim"><input type="time" name="ends_at" required defaultValue="18:00" /></Field><div className={styles.toolbarGroup}><button className={styles.button}>Adicionar</button></div></form>}
      {showExceptionForm && <form className={styles.form} onSubmit={addException}><Field label="Tipo"><select name="kind"><option value="UNAVAILABLE">Indisponível / folga</option><option value="AVAILABLE_OVERRIDE">Disponível em exceção</option></select></Field><Field label="Motivo"><input name="reason" required /></Field><Field label="Início"><input type="datetime-local" name="start" required /></Field><Field label="Fim"><input type="datetime-local" name="end" required /></Field><button className={styles.button}>Adicionar exceção</button></form>}
      {showCommissionForm && <form className={styles.form} onSubmit={addCommissionRule}><Field label="Aplicação"><select name="service_id"><option value="">Padrão do profissional</option>{props.services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></Field><Field label="Modelo"><select name="mode"><option value="PERCENT">Percentual (%)</option><option value="FIXED">Fixo (R$)</option></select></Field><Field label="Valor"><input name="value" type="number" min="0" step="0.01" required /></Field><div className={styles.toolbarGroup}><button className={styles.button}>Criar versão</button></div></form>}
      {scheduleBarber && <div className={styles.grid}>
        <section className={styles.span7}><h3>Escala semanal</h3><div className={styles.schedule}>{weekDays.map((day, index) => <div className={styles.day} key={day}><strong>{day}</strong>{intervals.filter((item) => item.weekday === index).map((item) => <span key={item.id}>{item.starts_at.slice(0, 5)}–{item.ends_at.slice(0, 5)} <button aria-label="Remover intervalo" type="button" onClick={() => removeInterval(item.id)}>×</button></span>)}</div>)}</div></section>
        <section className={styles.span5}><h3>Comissões vigentes</h3><div className={styles.list}>{rules.length ? rules.map((rule) => <div className={styles.rowTitle} key={rule.id}><strong>{rule.service_id ? serviceById.get(rule.service_id)?.name : "Padrão"}</strong><small>{rule.mode === "PERCENT" ? `${(rule.percentage_bps ?? 0) / 100}%` : formatCents(rule.fixed_cents)}</small></div>) : <span className={styles.muted}>Nenhuma regra: comissão zero.</span>}</div></section>
        <section className={styles.span12}><h3>Exceções</h3>{exceptions.length ? <div className={styles.list}>{exceptions.map((item) => <article className={styles.row} key={item.id}><span className={styles.rowTitle}><strong>{item.kind === "UNAVAILABLE" ? "Indisponível" : "Disponível"}</strong><small>{item.reason ?? "Sem motivo"}</small></span><span>{formatRange(item.service_period)}</span><span /><span /><span className={styles.rowActions}><button className={`${styles.button} ${styles.buttonDanger} ${styles.buttonSmall}`} type="button" onClick={() => removeException(item.id)}>Remover</button></span></article>)}</div> : <span className={styles.muted}>Nenhuma folga ou exceção cadastrada.</span>}</section>
      </div>}
    </Panel>
  </div>;
}
