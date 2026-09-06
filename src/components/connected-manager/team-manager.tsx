"use client";

import { useMemo, useState, type FormEvent, useRef } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { normalizePhoneE164 } from "@/lib/phone";
import type { loadTeamData } from "./server";
import type { AwaitedReturn } from "./utility-types";
import type { BarberRecord } from "./types";
import { centsFromInput, formatCents, formatRange, initials, toPostgresRange, weekDays } from "./format";
import { ActionMessage, EmptyState, Field, Panel, StatusChip } from "./shared";
import { assertResult, connectedClient, runMutation } from "./mutation-utils";
import styles from "./connected-manager.module.css";

type TeamData = AwaitedReturn<typeof loadTeamData>;
type Props = Omit<TeamData, "financialAccounts" | "barberAccountPermissions"> & Partial<Pick<TeamData, "financialAccounts" | "barberAccountPermissions">>;
type ProfessionalFilter = "ACTIVE" | "INACTIVE";
type OperationForm = "SCHEDULE" | "EXCEPTION" | "COMMISSION" | "PAYMENT" | null;
type CommissionPaymentFrequency = "PER_SERVICE" | "WEEKLY" | "BIWEEKLY" | "MONTHLY";

async function profileImage320(file: File) {
  if (!/^image\/(png|jpeg|webp)$/u.test(file.type) || file.size > 2 * 1024 * 1024) {
    throw new Error("Foto deve ser PNG, JPEG ou WebP de até 2 MB.");
  }
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new window.Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Não foi possível ler esta foto."));
      element.src = sourceUrl;
    });
    const cropSize = Math.min(image.naturalWidth, image.naturalHeight);
    if (!cropSize) throw new Error("Não foi possível ler esta foto.");
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 320;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Não foi possível preparar esta foto.");
    context.drawImage(image, (image.naturalWidth - cropSize) / 2, (image.naturalHeight - cropSize) / 2, cropSize, cropSize, 0, 0, 320, 320);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
    if (!blob) throw new Error("Não foi possível preparar esta foto.");
    return new File([blob], "perfil.webp", { type: "image/webp" });
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

export function TeamManager(props: Props) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [barberForm, setBarberForm] = useState<BarberRecord | "new" | null>(props.barbers.length ? null : "new");
  const [professionalFilter, setProfessionalFilter] = useState<ProfessionalFilter>("ACTIVE");
  const [query, setQuery] = useState("");
  const [scheduleBarber, setScheduleBarber] = useState(props.barbers.find((item) => item.active)?.id ?? "");
  const [activeOperationForm, setActiveOperationForm] = useState<OperationForm>(null);
  const [operationOpen, setOperationOpen] = useState(false);
  const [commissionPaymentFrequency, setCommissionPaymentFrequency] = useState<CommissionPaymentFrequency>("PER_SERVICE");
  const photoInputRef = useRef<HTMLInputElement>(null);
  const activeLocation = props.locations.find((location) => location.active);
  const serviceById = useMemo(() => new Map(props.services.map((service) => [service.id, service])), [props.services]);
  const selectedBarber = props.barbers.find((barber) => barber.id === scheduleBarber);
  const filteredBarbers = props.barbers.filter((barber) => barber.active === (professionalFilter === "ACTIVE") && `${barber.display_name} ${barber.whatsapp_e164 ?? ""} ${barber.bio ?? ""}`.toLowerCase().includes(query.toLowerCase()));

  async function saveBarber(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const editing = barberForm === "new" || barberForm === null ? null : barberForm;
    const rawWhatsapp = String(data.get("whatsapp_e164") ?? "").trim();
    const whatsappE164 = normalizePhoneE164(rawWhatsapp);
    const submittedPhoto = data.get("avatar");
    const photo = submittedPhoto instanceof File && submittedPhoto.size > 0 ? submittedPhoto : null;
    let preparedPhoto: File | null = null;
    try {
      preparedPhoto = photo ? await profileImage320(photo) : null;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível preparar esta foto.");
      return;
    }
    const payload = {
      organization_id: props.organizationId,
      location_id: String(data.get("location_id") || activeLocation?.id || ""),
      display_name: String(data.get("display_name") ?? "").trim(),
      bio: String(data.get("bio") ?? "").trim() || null,
      whatsapp_e164: whatsappE164,
      login_email: String(data.get("login_email") ?? "").trim().toLowerCase() || null,
      app_access_enabled: data.get("app_access_enabled") === "on",
      agenda_access_scope: String(data.get("agenda_access_scope") ?? "OWN"),
      cash_access_enabled: data.get("cash_access_enabled") === "on",
    };
    const saved = await runMutation(setMessage, async () => {
      if (!payload.location_id) throw new Error("Cadastre uma unidade ativa antes da equipe.");
      if (rawWhatsapp && !whatsappE164) throw new Error("Informe um WhatsApp válido para o profissional.");
      const client = connectedClient();
      let barberId = editing?.id;
      if (editing) {
        const result = await client.from("barbers").update(payload).eq("id", editing.id).eq("organization_id", props.organizationId).select("id,agenda_access_scope").maybeSingle();
        await assertResult(result);
        if (!result.data) throw new Error("Não foi possível confirmar a atualização do profissional.");
        if (result.data.agenda_access_scope !== payload.agenda_access_scope) throw new Error("O nível de acesso à agenda não foi salvo. Tente novamente.");
      } else {
        const result = await client.from("barbers").insert(payload).select("id").single();
        await assertResult(result);
        barberId = result.data?.id;
      }
      if (!barberId) throw new Error("Não foi possível identificar o profissional salvo.");
      const financialAccountIds = data.getAll("financial_account_ids").map(String).filter(Boolean);
      await assertResult(await client.rpc("set_barber_financial_accounts", {
        p_barber_id: barberId,
        p_financial_account_ids: financialAccountIds,
      }));
      if (preparedPhoto) {
        const path = `${props.organizationId}/${barberId}/${crypto.randomUUID()}.webp`;
        await assertResult(await client.storage.from("barber-avatars").upload(path, preparedPhoto, { contentType: "image/webp", cacheControl: "31536000" }));
        const avatarUrl = client.storage.from("barber-avatars").getPublicUrl(path).data.publicUrl;
        await assertResult(await client.from("barbers").update({ avatar_url: avatarUrl }).eq("id", barberId).eq("organization_id", props.organizationId));
      }
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
    if (saved) { setActiveOperationForm(null); router.refresh(); }
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
    if (saved) { setActiveOperationForm(null); router.refresh(); }
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
    if (saved) { setActiveOperationForm(null); router.refresh(); }
  }

  async function saveCommissionPaymentSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const frequency = String(data.get("commission_payment_frequency")) as CommissionPaymentFrequency;
    const saved = await runMutation(setMessage, async () => {
      if (!scheduleBarber) throw new Error("Selecione um profissional.");
      await assertResult(await connectedClient().from("barbers").update({
        commission_payment_frequency: frequency,
        commission_payment_weekday: frequency === "WEEKLY" ? Number(data.get("commission_payment_weekday")) : null,
        commission_payment_first_day: frequency === "BIWEEKLY" || frequency === "MONTHLY" ? Number(data.get("commission_payment_first_day")) : null,
        commission_payment_second_day: frequency === "BIWEEKLY" ? Number(data.get("commission_payment_second_day")) : null,
      }).eq("id", scheduleBarber).eq("organization_id", props.organizationId));
    }, "Forma de pagamento da comissão atualizada.");
    if (saved) router.refresh();
  }

  const intervals = props.workIntervals.filter((item) => item.barber_id === scheduleBarber && item.active);
  const exceptions = props.exceptions.filter((item) => item.barber_id === scheduleBarber);
  const rules = props.commissionRules.filter((item) => item.barber_id === scheduleBarber && item.active);

  return <div className={styles.stack}>
    <PageHeader title="Equipe" description="Profissionais, competências, escalas, folgas e regras versionadas." />
    <ActionMessage message={message} />
    <Panel title="Profissionais" titleAdornment={<select aria-label="Filtro de profissionais" className={styles.professionalFilter} value={professionalFilter} onChange={(event) => setProfessionalFilter(event.target.value as ProfessionalFilter)}><option value="ACTIVE">Ativos</option><option value="INACTIVE">Inativos</option></select>} description={`${props.barbers.filter((item) => item.active).length} ativos`} action={<button className={styles.button} type="button" onClick={() => setBarberForm("new")}>Novo profissional</button>}>
      {barberForm && <div className="modal-layer" role="presentation">
        <button className="modal-layer__backdrop" type="button" aria-label="Fechar" onClick={() => setBarberForm(null)} />
        <form className="form-modal" role="dialog" aria-modal="true" aria-label={barberForm === "new" ? "Novo profissional" : "Editar profissional"} onSubmit={saveBarber} key={barberForm === "new" ? "new" : barberForm.id}>
          <div className="form-modal__head"><span><small>{barberForm === "new" ? "Novo profissional" : "Editar profissional"}</small><strong>{barberForm === "new" ? "Cadastre um profissional" : "Atualize os dados"}</strong></span><button type="button" className="icon-button" onClick={() => setBarberForm(null)} aria-label="Fechar"><X size={19} /></button></div>
          <div className="form-modal__body">
            {message && <ActionMessage message={message} tone={message.includes("atualizado") || message.includes("Salvando") ? "info" : "error"} />}
            <Field label="Nome completo"><input name="display_name" required minLength={2} defaultValue={barberForm === "new" ? "" : barberForm.display_name} /></Field>
            <Field label="Unidade"><select name="location_id" required defaultValue={barberForm === "new" ? activeLocation?.id : barberForm.location_id}>{props.locations.filter((item) => item.active).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></Field>
            <Field label="WhatsApp do profissional"><><input name="whatsapp_e164" inputMode="tel" required placeholder="47999999999 ou +5547999999999" pattern="[+0-9][0-9\s().-]{7,20}" defaultValue={barberForm === "new" ? "" : barberForm.whatsapp_e164 ?? ""} onBlur={(event) => { const normalized = normalizePhoneE164(event.currentTarget.value); if (normalized) event.currentTarget.value = normalized; }} /><small>Usado somente para avisos transacionais dos próprios agendamentos.</small></></Field>
            <Field label="E-mail de acesso do Barbeiro"><><input name="login_email" type="email" defaultValue={barberForm === "new" ? "" : barberForm.login_email ?? ""} /><small>Deve ser igual ao e-mail usado no login. Sem este cadastro, o App do Barbeiro não libera acesso.</small></></Field>
            <Field label="Agenda no App do Barbeiro"><select name="agenda_access_scope" defaultValue={barberForm === "new" ? "OWN" : barberForm.agenda_access_scope ?? "OWN"}><option value="OWN">Somente a própria agenda</option><option value="FULL">Agenda completa da barbearia</option></select></Field>
            <Field label="Acesso ao App"><label className={styles.check}><input name="app_access_enabled" type="checkbox" defaultChecked={barberForm !== "new" && Boolean(barberForm.app_access_enabled)} />Liberar login do Barbeiro</label></Field>
            <Field label="Acesso ao Caixa"><label className={styles.check}><input name="cash_access_enabled" type="checkbox" defaultChecked={barberForm !== "new" && Boolean(barberForm.cash_access_enabled)} />Permitir recebimentos no Caixa individual</label></Field>
            <Field label="Contas que pode receber"><select name="financial_account_ids" multiple defaultValue={barberForm === "new" ? [] : (props.barberAccountPermissions ?? []).filter((item) => item.barber_id === barberForm.id).map((item) => item.financial_account_id)}>{(props.financialAccounts ?? []).map((account) => <option key={account.id} value={account.id}>{account.name} · {account.kind === "CASH" ? "Caixa" : "Banco"}</option>)}</select></Field>
            <Field label="Apresentação"><textarea name="bio" defaultValue={barberForm === "new" ? "" : barberForm.bio ?? ""} /></Field>
            <div className={styles.field}><span>Foto de perfil</span><div className={styles.profilePhotoField}><span className={styles.profilePhotoPreview}>{barberForm !== "new" && barberForm.avatar_url ? <Image src={barberForm.avatar_url} alt="" width={64} height={64} sizes="64px" /> : initials(barberForm === "new" ? "Profissional" : barberForm.display_name)}</span><span><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => photoInputRef.current?.click()}>Adicionar foto</button><input ref={photoInputRef} className={styles.fileInput} type="file" name="avatar" accept="image/png,image/jpeg,image/webp" /><small>Será centralizada e salva em 320 × 320 pixels.</small></span></div></div>
          </div>
          <div className="form-modal__footer"><button className="button button--ghost" type="button" onClick={() => setBarberForm(null)}>Cancelar</button><button className="button button--dark" type="submit">{barberForm === "new" ? "Cadastrar" : "Salvar"}</button></div>
        </form>
      </div>}
      <div className={styles.toolbar}><label className={styles.field}><span>Buscar</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome ou WhatsApp" /></label></div>
      {filteredBarbers.length === 0 ? <EmptyState title={props.barbers.length ? "Nenhum resultado" : "Cadastre a equipe"}>{props.barbers.length ? "Ajuste a busca ou altere o filtro." : "A unidade precisa de pelo menos um profissional para abrir a agenda."}</EmptyState> : <div className={styles.list}>{filteredBarbers.map((barber) => {
        const skills = props.barberServices.filter((link) => link.barber_id === barber.id && link.active);
        return <article className={`${styles.row} ${styles.professionalRow}`} key={barber.id}><span className={styles.professionalTitle}><i className={styles.avatar}>{barber.avatar_url ? <Image src={barber.avatar_url} alt="" width={42} height={42} sizes="42px" /> : initials(barber.display_name)}</i><span className={styles.rowTitle}><strong>{barber.display_name}</strong><small>{barber.bio ?? "Sem apresentação"}</small></span></span>
          <span className={styles.professionalWhatsapp}>{barber.whatsapp_e164 ?? "WhatsApp não cadastrado"}</span>
          <span className={styles.professionalSkills}>{props.services.length ? props.services.map((service) => { const checked = skills.some((link) => link.service_id === service.id); return <label className={styles.check} key={service.id}><input type="checkbox" checked={checked} onChange={(event) => toggleSkill(barber.id, service.id, event.target.checked)} />{service.name}</label>; }) : <small className={styles.muted}>Sem serviços cadastrados</small>}</span>
          <StatusChip active={barber.active} />
          <div className={styles.rowActions}><button className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} type="button" onClick={() => { setScheduleBarber(barber.id); setActiveOperationForm(null); setCommissionPaymentFrequency(barber.commission_payment_frequency ?? "PER_SERVICE"); setOperationOpen(true); }}>Escala e comissão</button><button className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} type="button" onClick={() => setBarberForm(barber)}>Editar</button><button className={`${styles.button} ${barber.active ? styles.buttonDanger : styles.buttonSoft} ${styles.buttonSmall}`} type="button" onClick={() => toggleBarber(barber)}>{barber.active ? "Inativar" : "Reativar"}</button></div>
        </article>;
      })}</div>}
    </Panel>

    {operationOpen && selectedBarber && <div className="modal-layer" role="presentation">
      <button className="modal-layer__backdrop" type="button" aria-label="Fechar configurações" onClick={() => setOperationOpen(false)} />
      <section className={`form-modal ${styles.teamOperationModal}`} role="dialog" aria-modal="true" aria-label={`Escala e comissão de ${selectedBarber.display_name}`}>
        <div className="form-modal__head"><span><small>Configuração do profissional</small><strong>Escala, exceções e comissão</strong></span><button type="button" className="icon-button" onClick={() => setOperationOpen(false)} aria-label="Fechar"><X size={19} /></button></div>
        <div className="form-modal__body">
          <p className={styles.operationDescription}>{selectedBarber.display_name}</p>
          <div className={styles.toolbarGroup}><button className={`${styles.button} ${activeOperationForm === "SCHEDULE" ? "" : styles.buttonSoft}`} type="button" onClick={() => setActiveOperationForm((value) => value === "SCHEDULE" ? null : "SCHEDULE")}>Adicionar horário</button><button className={`${styles.button} ${activeOperationForm === "EXCEPTION" ? "" : styles.buttonSoft}`} type="button" onClick={() => setActiveOperationForm((value) => value === "EXCEPTION" ? null : "EXCEPTION")}>Adicionar folga/exceção</button><button className={`${styles.button} ${activeOperationForm === "COMMISSION" ? "" : styles.buttonSoft}`} type="button" onClick={() => setActiveOperationForm((value) => value === "COMMISSION" ? null : "COMMISSION")}>Nova comissão</button><button className={`${styles.button} ${activeOperationForm === "PAYMENT" ? "" : styles.buttonSoft}`} type="button" onClick={() => setActiveOperationForm((value) => value === "PAYMENT" ? null : "PAYMENT")}>Forma de Pagamento</button></div>
          {activeOperationForm === "SCHEDULE" && <form className={styles.form} onSubmit={addInterval}><Field label="Dia"><select name="weekday">{weekDays.map((day, index) => <option value={index} key={day}>{day}</option>)}</select></Field><Field label="Início"><input type="time" name="starts_at" required defaultValue="09:00" /></Field><Field label="Fim"><input type="time" name="ends_at" required defaultValue="18:00" /></Field><div className={styles.toolbarGroup}><button className={styles.button}>Adicionar</button></div></form>}
          {activeOperationForm === "EXCEPTION" && <form className={styles.form} onSubmit={addException}><Field label="Tipo"><select name="kind"><option value="UNAVAILABLE">Indisponível / folga</option><option value="AVAILABLE_OVERRIDE">Disponível em exceção</option></select></Field><Field label="Motivo"><input name="reason" required /></Field><Field label="Início"><input type="datetime-local" name="start" required /></Field><Field label="Fim"><input type="datetime-local" name="end" required /></Field><button className={styles.button}>Adicionar exceção</button></form>}
          {activeOperationForm === "COMMISSION" && <form className={styles.form} onSubmit={addCommissionRule}><Field label="Aplicação"><select name="service_id"><option value="">Padrão do profissional</option>{props.services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></Field><Field label="Modelo"><select name="mode"><option value="PERCENT">Percentual (%)</option><option value="FIXED">Fixo (R$)</option></select></Field><Field label="Valor"><input name="value" type="number" min="0" step="0.01" required /></Field><div className={styles.toolbarGroup}><button className={styles.button}>Criar versão</button></div></form>}
          {activeOperationForm === "PAYMENT" && <form className={styles.form} onSubmit={saveCommissionPaymentSchedule}>
            <Field label="Forma de pagamento"><select name="commission_payment_frequency" value={commissionPaymentFrequency} onChange={(event) => setCommissionPaymentFrequency(event.target.value as CommissionPaymentFrequency)}><option value="PER_SERVICE">Por serviço</option><option value="WEEKLY">Por semana</option><option value="BIWEEKLY">Quinzenal</option><option value="MONTHLY">Mensal</option></select></Field>
            {commissionPaymentFrequency === "WEEKLY" && <Field label="Dia do pagamento"><select name="commission_payment_weekday" defaultValue={selectedBarber.commission_payment_weekday ?? 1}><option value="1">Segunda-feira</option><option value="2">Terça-feira</option><option value="3">Quarta-feira</option><option value="4">Quinta-feira</option><option value="5">Sexta-feira</option><option value="6">Sábado</option><option value="7">Domingo</option></select></Field>}
            {commissionPaymentFrequency === "BIWEEKLY" && <><Field label="1º pagamento"><input name="commission_payment_first_day" type="number" min="1" max="31" required defaultValue={selectedBarber.commission_payment_first_day ?? ""} /></Field><Field label="2º pagamento"><input name="commission_payment_second_day" type="number" min="1" max="31" required defaultValue={selectedBarber.commission_payment_second_day ?? ""} /></Field></>}
            {commissionPaymentFrequency === "MONTHLY" && <Field label="Dia do pagamento"><input name="commission_payment_first_day" type="number" min="1" max="31" required defaultValue={selectedBarber.commission_payment_first_day ?? ""} /></Field>}
            <div className={styles.toolbarGroup}><button className={styles.button}>Salvar pagamento</button></div>
          </form>}
          <div className={styles.grid}>
            <section className={styles.span12}><h3>Escala semanal</h3><div className={styles.schedule}>{weekDays.map((day, index) => <div className={styles.day} key={day}><strong>{day}</strong>{intervals.filter((item) => item.weekday === index).map((item) => <span key={item.id}>{item.starts_at.slice(0, 5)}–{item.ends_at.slice(0, 5)} <button aria-label="Remover intervalo" type="button" onClick={() => removeInterval(item.id)}>×</button></span>)}</div>)}</div></section>
            <section className={styles.span12}><h3>Exceções</h3>{exceptions.length ? <div className={styles.list}>{exceptions.map((item) => <article className={styles.row} key={item.id}><span className={styles.rowTitle}><strong>{item.kind === "UNAVAILABLE" ? "Indisponível" : "Disponível"}</strong><small>{item.reason ?? "Sem motivo"}</small></span><span>{formatRange(item.service_period)}</span><span /><span /><span className={styles.rowActions}><button className={`${styles.button} ${styles.buttonDanger} ${styles.buttonSmall}`} type="button" onClick={() => removeException(item.id)}>Remover</button></span></article>)}</div> : <span className={styles.muted}>Nenhuma folga ou exceção cadastrada.</span>}</section>
            <section className={styles.span12}><h3>Comissões vigentes</h3><div className={styles.list}>{rules.length ? rules.map((rule) => <div className={styles.rowTitle} key={rule.id}><strong>{rule.service_id ? serviceById.get(rule.service_id)?.name : "Padrão"}</strong><small>{rule.mode === "PERCENT" ? `${(rule.percentage_bps ?? 0) / 100}%` : formatCents(rule.fixed_cents)}</small></div>) : <span className={styles.muted}>Nenhuma regra: comissão zero.</span>}</div></section>
          </div>
        </div>
        <div className="form-modal__footer"><button className="button button--ghost" type="button" onClick={() => setOperationOpen(false)}>Fechar</button></div>
      </section>
    </div>}
  </div>;
}
