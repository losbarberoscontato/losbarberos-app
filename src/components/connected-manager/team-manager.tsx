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
import { centsFromInput, formatRange, initials, toPostgresRange, weekDays } from "./format";
import { ActionMessage, EmptyState, Field, Panel, StatusChip } from "./shared";
import { assertResult, connectedClient, runMutation } from "./mutation-utils";
import styles from "./connected-manager.module.css";

type TeamData = AwaitedReturn<typeof loadTeamData>;
type Props = Omit<TeamData, "financialAccounts" | "barberAccountPermissions" | "managerUserId" | "environments"> & Partial<Pick<TeamData, "financialAccounts" | "barberAccountPermissions">> & { managerUserId?: string; environments?: TeamData["environments"] };
type ProfessionalFilter = "ACTIVE" | "INACTIVE";
type OperationForm = "SCHEDULE" | "EXCEPTION" | null;
type CommissionPaymentFrequency = "PER_SERVICE" | "WEEKLY" | "BIWEEKLY" | "MONTHLY";
type CommissionMode = "PERCENT" | "FIXED";
type ServiceDraft = { enabled: boolean; mode: CommissionMode; value: string };

function centsInput(cents: number) {
  // Inputs do tipo number aceitam ponto como separador decimal, mesmo na
  // interface pt-BR. A conversão para centavos continua tratando vírgula.
  return (cents / 100).toFixed(2);
}

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
  const [servicesOpen, setServicesOpen] = useState(false);
  const [serviceDrafts, setServiceDrafts] = useState<Record<string, ServiceDraft>>({});
  const [defaultCommissionDraft, setDefaultCommissionDraft] = useState<ServiceDraft>({ enabled: true, mode: "PERCENT", value: "" });
  const [commissionPaymentFrequency, setCommissionPaymentFrequency] = useState<CommissionPaymentFrequency>("PER_SERVICE");
  const [scheduleWeekday, setScheduleWeekday] = useState("0");
  const [scheduleStartsAt, setScheduleStartsAt] = useState("09:00");
  const [scheduleEndsAt, setScheduleEndsAt] = useState("18:00");
  const [exceptionKind, setExceptionKind] = useState("UNAVAILABLE");
  const photoInputRef = useRef<HTMLInputElement>(null);
  const activeLocation = props.locations.find((location) => location.active);
  const barberById = useMemo(() => new Map(props.barbers.map((barber) => [barber.id, barber])), [props.barbers]);
  const selectedBarber = props.barbers.find((barber) => barber.id === scheduleBarber);
  const filteredBarbers = props.barbers.filter((barber) => barber.active === (professionalFilter === "ACTIVE") && `${barber.display_name} ${barber.whatsapp_e164 ?? ""} ${barber.bio ?? ""}`.toLowerCase().includes(query.toLowerCase()));

  async function saveBarber(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const editing = barberForm === "new" || barberForm === null ? null : barberForm;
    const editingManager = Boolean(editing?.is_manager || editing?.auth_user_id === props.managerUserId);
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
      professional_function_id: String(data.get("professional_function_id") ?? "") || null,
      bio: String(data.get("bio") ?? "").trim() || null,
      whatsapp_e164: whatsappE164,
      login_email: editingManager
        ? editing?.login_email ?? null
        : String(data.get("login_email") ?? "").trim().toLowerCase() || null,
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

  function selectBarber(barberId: string) {
    const barber = props.barbers.find((item) => item.id === barberId);
    setScheduleBarber(barberId);
    setCommissionPaymentFrequency(barber?.commission_payment_frequency ?? "PER_SERVICE");
  }

  function openScale(barberId: string) {
    selectBarber(barberId);
    setActiveOperationForm(null);
    setOperationOpen(true);
    setServicesOpen(false);
  }

  function openServices(barberId: string) {
    selectBarber(barberId);
    setMessage("");
    const nextDrafts: Record<string, ServiceDraft> = {};
    for (const service of props.services) {
      const link = props.barberServices.find((item) => item.barber_id === barberId && item.service_id === service.id);
      const rule = props.commissionRules.find((item) => item.active && item.barber_id === barberId && item.service_id === service.id);
      nextDrafts[service.id] = {
        enabled: Boolean(link?.active),
        mode: rule?.mode ?? "PERCENT",
        value: rule?.mode === "FIXED" ? centsInput(rule.fixed_cents ?? 0) : rule?.mode === "PERCENT" ? ((rule.percentage_bps ?? 0) / 100).toString() : "",
      };
    }
    const defaultRule = props.commissionRules.find((item) => item.active && item.barber_id === barberId && item.service_id === null);
    setDefaultCommissionDraft({
      enabled: Boolean(defaultRule),
      mode: defaultRule?.mode ?? "PERCENT",
      value: defaultRule?.mode === "FIXED" ? centsInput(defaultRule.fixed_cents ?? 0) : defaultRule?.mode === "PERCENT" ? ((defaultRule.percentage_bps ?? 0) / 100).toString() : "",
    });
    setServiceDrafts(nextDrafts);
    setServicesOpen(true);
    setOperationOpen(false);
    setActiveOperationForm(null);
  }

  function updateServiceDraft(serviceId: string, patch: Partial<ServiceDraft>) {
    setServiceDrafts((current) => ({ ...current, [serviceId]: { ...(current[serviceId] ?? { enabled: false, mode: "PERCENT", value: "" }), ...patch } }));
  }

  async function saveServiceSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const saved = await runMutation(setMessage, async () => {
      if (!scheduleBarber) throw new Error("Selecione um profissional.");
      const client = connectedClient();
      for (const service of props.services) {
        const draft = serviceDrafts[service.id] ?? { enabled: false, mode: "PERCENT" as const, value: "" };
        await assertResult(await client.from("barber_services").upsert({ organization_id: props.organizationId, barber_id: scheduleBarber, service_id: service.id, active: draft.enabled }, { onConflict: "barber_id,service_id" }));
        if (!draft.enabled) continue;
        const currentRule = props.commissionRules.find((rule) => rule.active && rule.barber_id === scheduleBarber && rule.service_id === service.id);
        // O vínculo do serviço pode ser salvo sem comissão; nesse caso, a regra
        // vigente permanece inalterada até que um valor seja informado.
        if (!draft.value.trim()) continue;
        const numericValue = draft.mode === "FIXED" ? centsFromInput(draft.value) : Number(draft.value.replace(",", "."));
        if (!Number.isFinite(numericValue) || numericValue < 0) throw new Error(`Informe um valor válido para a comissão de ${service.name}.`);
        await assertResult(await client.rpc("replace_commission_rule", {
          p_organization_id: props.organizationId,
          p_barber_id: scheduleBarber,
          p_service_id: service.id,
          p_mode: draft.mode,
          p_percentage_bps: draft.mode === "PERCENT" ? Math.round(numericValue * 100) : null,
          p_fixed_cents: draft.mode === "FIXED" ? numericValue : null,
          p_effective_at: new Date().toISOString(),
          p_current_rule_id: currentRule?.id ?? null,
        }));
      }
      if (defaultCommissionDraft.enabled && defaultCommissionDraft.value.trim()) {
        const numericValue = defaultCommissionDraft.mode === "FIXED" ? centsFromInput(defaultCommissionDraft.value) : Number(defaultCommissionDraft.value.replace(",", "."));
        if (!Number.isFinite(numericValue) || numericValue < 0) throw new Error("Informe um valor válido para a comissão padrão.");
        const currentDefaultRule = props.commissionRules.find((rule) => rule.active && rule.barber_id === scheduleBarber && rule.service_id === null);
        await assertResult(await client.rpc("replace_commission_rule", {
          p_organization_id: props.organizationId,
          p_barber_id: scheduleBarber,
          p_service_id: null,
          p_mode: defaultCommissionDraft.mode,
          p_percentage_bps: defaultCommissionDraft.mode === "PERCENT" ? Math.round(numericValue * 100) : null,
          p_fixed_cents: defaultCommissionDraft.mode === "FIXED" ? numericValue : null,
          p_effective_at: new Date().toISOString(),
          p_current_rule_id: currentDefaultRule?.id ?? null,
        }));
      }
      const frequency = String(formData.get("commission_payment_frequency")) as CommissionPaymentFrequency;
      await assertResult(await client.from("barbers").update({
        commission_payment_frequency: frequency,
        commission_payment_weekday: frequency === "WEEKLY" ? Number(formData.get("commission_payment_weekday")) : null,
        commission_payment_first_day: frequency === "BIWEEKLY" || frequency === "MONTHLY" ? Number(formData.get("commission_payment_first_day")) : null,
        commission_payment_second_day: frequency === "BIWEEKLY" ? Number(formData.get("commission_payment_second_day")) : null,
      }).eq("id", scheduleBarber).eq("organization_id", props.organizationId));
    }, "Serviços e pagamento atualizados.");
    if (saved) { setServicesOpen(false); router.refresh(); }
  }

  async function addInterval(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const saved = await runMutation(setMessage, async () => {
      if (!scheduleBarber) throw new Error("Selecione um profissional.");
      const environmentId = String(data.get("environment_id") ?? "");
      if (!environmentId) throw new Error("Escolha um ambiente para o horário.");
      await assertResult(await connectedClient().from("work_intervals").insert({
        organization_id: props.organizationId,
        barber_id: scheduleBarber,
        weekday: Number(data.get("weekday")),
        starts_at: String(data.get("starts_at")),
        ends_at: String(data.get("ends_at")),
        environment_id: environmentId,
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
        environment_id: String(data.get("kind")) === "AVAILABLE_OVERRIDE" ? String(data.get("environment_id") ?? "") || null : null,
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

  const intervals = props.workIntervals.filter((item) => item.barber_id === scheduleBarber && item.active);
  const exceptions = props.exceptions.filter((item) => item.barber_id === scheduleBarber);
  const editingManager = barberForm !== "new" && barberForm !== null && Boolean(barberForm.is_manager || barberForm.auth_user_id === props.managerUserId);
  const scheduleLocationId = selectedBarber?.location_id ?? activeLocation?.id ?? "";
  const scheduleEnvironments = (props.environments ?? []).filter((item) => item.location_id === scheduleLocationId && item.active).sort((left, right) => left.sort_order - right.sort_order);
  const occupiedEnvironmentIds = new Set(props.workIntervals
    .filter((item) => item.active && item.weekday === Number(scheduleWeekday) && item.starts_at < scheduleEndsAt && item.ends_at > scheduleStartsAt)
    .filter((item) => barberById.get(item.barber_id)?.location_id === scheduleLocationId)
    .map((item) => item.environment_id)
    .filter((value): value is string => Boolean(value)));
  const availableScheduleEnvironments = scheduleEnvironments.filter((item) => !occupiedEnvironmentIds.has(item.id));
  const serviceGroups = ([
    ["CLIENT", "Cliente"],
    ["HIDDEN", "Gestão"],
    ["INTERNAL", "Interno"],
  ] as const).map(([key, label]) => ({ key, label, services: props.services.filter((service) => (service.availability ?? "CLIENT") === key) }));

  return <div className={styles.stack}>
    <PageHeader title="Equipe" description="Profissionais, serviços, escalas, folgas e regras versionadas." />
    <ActionMessage message={message} />
    <Panel title="Profissionais" titleAdornment={<select aria-label="Filtro de profissionais" className={styles.professionalFilter} value={professionalFilter} onChange={(event) => setProfessionalFilter(event.target.value as ProfessionalFilter)}><option value="ACTIVE">Ativos</option><option value="INACTIVE">Inativos</option></select>} description={`${props.barbers.filter((item) => item.active).length} ativos`} action={<button className={styles.button} type="button" onClick={() => setBarberForm("new")}>Novo profissional</button>}>
      {barberForm && <div className="modal-layer" role="presentation">
        <button className="modal-layer__backdrop" type="button" aria-label="Fechar" onClick={() => setBarberForm(null)} />
        <form className="form-modal" role="dialog" aria-modal="true" aria-label={barberForm === "new" ? "Novo profissional" : "Editar profissional"} onSubmit={saveBarber} key={barberForm === "new" ? "new" : barberForm.id}>
          <div className="form-modal__head"><span><small>{barberForm === "new" ? "Novo profissional" : "Editar profissional"}</small><strong>{barberForm === "new" ? "Cadastre um profissional" : "Atualize os dados"}</strong></span><button type="button" className="icon-button" onClick={() => setBarberForm(null)} aria-label="Fechar"><X size={19} /></button></div>
          <div className="form-modal__body">
            {message && <ActionMessage message={message} tone={message.includes("atualizado") || message.includes("Salvando") ? "info" : "error"} />}
            <div className="form-grid"><Field label="Nome completo"><input name="display_name" required minLength={2} defaultValue={barberForm === "new" ? "" : barberForm.display_name} /></Field><Field label="Função"><select name="professional_function_id" defaultValue={barberForm === "new" ? "" : barberForm.professional_function_id ?? ""}><option value="">Sem função</option>{props.professionalFunctions.map((professionalFunction) => <option key={professionalFunction.id} value={professionalFunction.id}>{professionalFunction.name}</option>)}</select></Field></div>
            <Field label="Unidade"><select name="location_id" required defaultValue={barberForm === "new" ? activeLocation?.id : barberForm.location_id}>{props.locations.filter((item) => item.active).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></Field>
            <Field label="WhatsApp do profissional"><><input name="whatsapp_e164" inputMode="tel" required placeholder="47999999999 ou +5547999999999" pattern="[+0-9][0-9\s().-]{7,20}" defaultValue={barberForm === "new" ? "" : barberForm.whatsapp_e164 ?? ""} onBlur={(event) => { const normalized = normalizePhoneE164(event.currentTarget.value); if (normalized) event.currentTarget.value = normalized; }} /><small>Usado somente para avisos transacionais dos próprios agendamentos.</small></></Field>
            <Field label="E-mail de acesso do Barbeiro"><><input name="login_email" type="email" readOnly={editingManager} aria-readonly={editingManager || undefined} defaultValue={barberForm === "new" ? "" : barberForm.login_email ?? ""} /><small>{editingManager ? "Vínculo original do login de administrador; não pode ser alterado." : "Deve ser igual ao e-mail usado no login. Sem este cadastro, o App do Barbeiro não libera acesso."}</small></></Field>
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
        const isManager = Boolean(barber.is_manager || barber.auth_user_id === props.managerUserId);
        return <article className={`${styles.row} ${styles.professionalRow}`} key={barber.id}><span className={styles.professionalTitle}><i className={styles.avatar}>{barber.avatar_url ? <Image src={barber.avatar_url} alt="" width={42} height={42} sizes="42px" /> : initials(barber.display_name)}</i><span className={styles.rowTitle}><span className={styles.professionalName}><strong>{barber.display_name}</strong>{isManager && <StatusChip active label="Administrador" tone="info" />}</span><small>{barber.bio ?? "Sem apresentação"}</small></span></span>
          <span className={styles.professionalWhatsapp}>{barber.whatsapp_e164 ?? "WhatsApp não cadastrado"}</span>
          <StatusChip active={barber.active} />
          <div className={styles.rowActions}><button className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} type="button" onClick={() => openScale(barber.id)}>Escala</button><button className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} type="button" onClick={() => openServices(barber.id)}>Serviços</button><button className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} type="button" onClick={() => setBarberForm(barber)}>Editar</button>{!isManager && <button className={`${styles.button} ${barber.active ? styles.buttonDanger : styles.buttonSoft} ${styles.buttonSmall}`} type="button" onClick={() => toggleBarber(barber)}>{barber.active ? "Inativar" : "Reativar"}</button>}</div>
        </article>;
      })}</div>}
    </Panel>

    {operationOpen && selectedBarber && <div className="modal-layer" role="presentation">
      <button className="modal-layer__backdrop" type="button" aria-label="Fechar configurações" onClick={() => setOperationOpen(false)} />
      <section className={`form-modal ${styles.teamOperationModal}`} role="dialog" aria-modal="true" aria-label={`Escala de ${selectedBarber.display_name}`}>
        <div className="form-modal__head"><span><small>Configuração do profissional</small><strong>Escala e exceções</strong></span><button type="button" className="icon-button" onClick={() => setOperationOpen(false)} aria-label="Fechar"><X size={19} /></button></div>
        <div className="form-modal__body">
          <p className={styles.operationDescription}>{selectedBarber.display_name}</p>
          <div className={styles.toolbarGroup}><button className={`${styles.button} ${activeOperationForm === "SCHEDULE" ? "" : styles.buttonSoft}`} type="button" onClick={() => setActiveOperationForm((value) => value === "SCHEDULE" ? null : "SCHEDULE")}>Adicionar horário</button><button className={`${styles.button} ${activeOperationForm === "EXCEPTION" ? "" : styles.buttonSoft}`} type="button" onClick={() => setActiveOperationForm((value) => value === "EXCEPTION" ? null : "EXCEPTION")}>Adicionar folga/exceção</button></div>
          {activeOperationForm === "SCHEDULE" && <form className={styles.form} onSubmit={addInterval}><Field label="Ambiente"><select name="environment_id" required defaultValue=""><option value="">Selecione um ambiente disponível</option>{availableScheduleEnvironments.map((environment) => <option value={environment.id} key={environment.id}>{environment.sort_order}º · {environment.name}</option>)}</select>{availableScheduleEnvironments.length === 0 && <small className={styles.muted}>Nenhum ambiente livre para esta faixa.</small>}</Field><Field label="Dia"><select name="weekday" value={scheduleWeekday} onChange={(event) => setScheduleWeekday(event.target.value)}>{weekDays.map((day, index) => <option value={index} key={day}>{day}</option>)}</select></Field><Field label="Início"><input type="time" name="starts_at" required value={scheduleStartsAt} onChange={(event) => setScheduleStartsAt(event.target.value)} /></Field><Field label="Fim"><input type="time" name="ends_at" required value={scheduleEndsAt} onChange={(event) => setScheduleEndsAt(event.target.value)} /></Field><div className={styles.toolbarGroup}><button className={styles.button} disabled={availableScheduleEnvironments.length === 0}>Adicionar</button></div></form>}
          {activeOperationForm === "EXCEPTION" && <form className={styles.form} onSubmit={addException}><Field label="Tipo"><select name="kind" value={exceptionKind} onChange={(event) => setExceptionKind(event.target.value)}><option value="UNAVAILABLE">Indisponível / folga</option><option value="AVAILABLE_OVERRIDE">Disponível em exceção</option></select></Field>{exceptionKind === "AVAILABLE_OVERRIDE" && <Field label="Ambiente"><select name="environment_id" required defaultValue=""><option value="">Selecione um ambiente</option>{scheduleEnvironments.map((environment) => <option value={environment.id} key={environment.id}>{environment.sort_order}º · {environment.name}</option>)}</select></Field>}<Field label="Motivo"><input name="reason" required /></Field><Field label="Início"><input type="datetime-local" name="start" required /></Field><Field label="Fim"><input type="datetime-local" name="end" required /></Field><button className={styles.button}>Adicionar exceção</button></form>}
          <div className={styles.grid}>
            <section className={styles.span12}><h3>Escala semanal</h3><div className={styles.schedule}>{weekDays.map((day, index) => <div className={styles.day} key={day}><strong>{day}</strong>{intervals.filter((item) => item.weekday === index).map((item) => <span key={item.id}>{item.starts_at.slice(0, 5)}–{item.ends_at.slice(0, 5)} · {scheduleEnvironments.find((environment) => environment.id === item.environment_id)?.name ?? "Ambiente pendente"} <button aria-label="Remover intervalo" type="button" onClick={() => removeInterval(item.id)}>×</button></span>)}</div>)}</div></section>
            <section className={styles.span12}><h3>Exceções</h3>{exceptions.length ? <div className={styles.list}>{exceptions.map((item) => <article className={styles.row} key={item.id}><span className={styles.rowTitle}><strong>{item.kind === "UNAVAILABLE" ? "Indisponível" : "Disponível"}</strong><small>{item.reason ?? "Sem motivo"}</small></span><span>{formatRange(item.service_period)}</span><span /><span /><span className={styles.rowActions}><button className={`${styles.button} ${styles.buttonDanger} ${styles.buttonSmall}`} type="button" onClick={() => removeException(item.id)}>Remover</button></span></article>)}</div> : <span className={styles.muted}>Nenhuma folga ou exceção cadastrada.</span>}</section>
          </div>
        </div>
        <div className="form-modal__footer"><button className="button button--ghost" type="button" onClick={() => setOperationOpen(false)}>Fechar</button></div>
      </section>
    </div>}

    {servicesOpen && selectedBarber && <div className="modal-layer" role="presentation">
      <button className="modal-layer__backdrop" type="button" aria-label="Fechar serviços" onClick={() => setServicesOpen(false)} />
      <form className={`form-modal ${styles.teamOperationModal}`} role="dialog" aria-modal="true" aria-label={`Serviços de ${selectedBarber.display_name}`} onSubmit={saveServiceSettings}>
        <div className="form-modal__head"><span><small>Configuração do profissional</small><strong>Serviços</strong></span><button type="button" className="icon-button" onClick={() => setServicesOpen(false)} aria-label="Fechar"><X size={19} /></button></div>
        <div className="form-modal__body">
          {message && <ActionMessage message={message} tone={message === "Salvando…" || message.includes("atualizados") ? "info" : "error"} />}
          <p className={styles.operationDescription}>{selectedBarber.display_name}</p>
          <section className={styles.serviceCommissionPanel}><h3>Serviços habilitados e comissão</h3><p className={styles.muted}>Selecione os serviços, defina o modelo e informe o valor da comissão.</p>
            <div className={styles.serviceCommissionGroups}>{serviceGroups.map((group) => <section className={styles.serviceCommissionGroup} key={group.key}><h4>{group.label}</h4>{group.services.length === 0 ? <p className={styles.serviceCommissionEmpty}>Nenhum serviço cadastrado neste setor.</p> : <><div className={styles.serviceCommissionHeader}><span>Serviço habilitado</span><span>Modelo</span><span>Valor</span></div>{group.services.map((service) => { const draft = serviceDrafts[service.id] ?? { enabled: false, mode: "PERCENT" as const, value: "" }; return <div className={styles.serviceCommissionRow} key={service.id}><label className={styles.check}><input type="checkbox" checked={draft.enabled} onChange={(event) => updateServiceDraft(service.id, { enabled: event.target.checked })} />{service.name}</label><select aria-label={`Modelo de comissão de ${service.name}`} value={draft.mode} onChange={(event) => updateServiceDraft(service.id, { mode: event.target.value as CommissionMode })} disabled={!draft.enabled}><option value="PERCENT">Percentual (%)</option><option value="FIXED">Fixo (R$)</option></select><input aria-label={`Valor da comissão de ${service.name}`} type="number" min="0" step="0.01" value={draft.value} onChange={(event) => updateServiceDraft(service.id, { value: event.target.value })} disabled={!draft.enabled} /></div>; })}</>}</section>)}</div>
          </section>
          <section className={styles.serviceDefaultCommission}><h3>Comissão padrão do profissional</h3><label className={styles.check}><input type="checkbox" checked={defaultCommissionDraft.enabled} onChange={(event) => setDefaultCommissionDraft((current) => ({ ...current, enabled: event.target.checked }))} />Usar comissão padrão</label><div className={styles.form}><Field label="Modelo"><select value={defaultCommissionDraft.mode} onChange={(event) => setDefaultCommissionDraft((current) => ({ ...current, mode: event.target.value as CommissionMode }))} disabled={!defaultCommissionDraft.enabled}><option value="PERCENT">Percentual (%)</option><option value="FIXED">Fixo (R$)</option></select></Field><Field label="Valor"><input type="number" min="0" step="0.01" value={defaultCommissionDraft.value} onChange={(event) => setDefaultCommissionDraft((current) => ({ ...current, value: event.target.value }))} disabled={!defaultCommissionDraft.enabled} /></Field></div></section>
          <section className={styles.servicePaymentPanel}><h3>Forma de pagamento da comissão</h3><div className={styles.form}><Field label="Forma de pagamento"><select name="commission_payment_frequency" value={commissionPaymentFrequency} onChange={(event) => setCommissionPaymentFrequency(event.target.value as CommissionPaymentFrequency)}><option value="PER_SERVICE">Por serviço</option><option value="WEEKLY">Por semana</option><option value="BIWEEKLY">Quinzenal</option><option value="MONTHLY">Mensal</option></select></Field>{commissionPaymentFrequency === "WEEKLY" && <Field label="Dia do pagamento"><select name="commission_payment_weekday" defaultValue={selectedBarber.commission_payment_weekday ?? 1}><option value="1">Segunda-feira</option><option value="2">Terça-feira</option><option value="3">Quarta-feira</option><option value="4">Quinta-feira</option><option value="5">Sexta-feira</option><option value="6">Sábado</option><option value="7">Domingo</option></select></Field>}{commissionPaymentFrequency === "BIWEEKLY" && <><Field label="1º pagamento"><input name="commission_payment_first_day" type="number" min="1" max="31" required defaultValue={selectedBarber.commission_payment_first_day ?? ""} /></Field><Field label="2º pagamento"><input name="commission_payment_second_day" type="number" min="1" max="31" required defaultValue={selectedBarber.commission_payment_second_day ?? ""} /></Field></>}{commissionPaymentFrequency === "MONTHLY" && <Field label="Dia do pagamento"><input name="commission_payment_first_day" type="number" min="1" max="31" required defaultValue={selectedBarber.commission_payment_first_day ?? ""} /></Field>}</div></section>
          <div className="form-modal__footer"><button className="button button--ghost" type="button" onClick={() => setServicesOpen(false)}>Cancelar</button><button className="button button--dark" type="submit">Salvar serviços</button></div>
        </div>
      </form>
    </div>}
  </div>;
}
