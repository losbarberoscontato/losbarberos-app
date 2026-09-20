"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { CircleHelp, Pencil, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui";
import type { loadSettingsData } from "./server";
import type { AwaitedReturn } from "./utility-types";
import { humanizeError } from "./format";
import { ActionMessage, Field, Panel, StatusChip } from "./shared";
import { assertResult, connectedClient, runMutation } from "./mutation-utils";
import { normalizePhoneE164 } from "@/lib/phone";
import { barberLoginHref } from "@/lib/barber-auth";
import styles from "./connected-manager.module.css";

type SettingsData = AwaitedReturn<typeof loadSettingsData>;
type Props = Omit<SettingsData, "environments" | "environmentIssues" | "professionalFunctions" | "professionalFunctionsAvailable"> & {
  environments?: SettingsData["environments"];
  environmentIssues?: SettingsData["environmentIssues"];
  professionalFunctions?: SettingsData["professionalFunctions"];
  professionalFunctionsAvailable?: boolean;
};

export function SettingsManager(props: Props) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [connecting, setConnecting] = useState(false);
  const publicOrigin = typeof window === "undefined"
    ? ""
    : (process.env.NEXT_PUBLIC_PUBLIC_APP_URL || window.location.origin).replace(/\/$/u, "");
  const queueUrl = props.organization.queue_public_id ? `${publicOrigin}/fila/${props.organization.queue_public_id}` : "";
  const bookingUrl = props.organization.booking_public_id
    ? `${publicOrigin}/b/${props.organization.booking_public_id}`
    : `${publicOrigin}/b/${props.organization.slug}`;
  const barberAccessPath = barberLoginHref("/barbeiro/agenda", props.organization.slug);
  const barberAccessUrl = `${publicOrigin}${barberAccessPath}`;
  const [exporting, setExporting] = useState(false);
  const [rulesHelpOpen, setRulesHelpOpen] = useState(false);
  const [rulesEditor, setRulesEditor] = useState<"deadline" | "environments" | "functions" | null>(null);
  const [environmentName, setEnvironmentName] = useState("");
  const [professionalFunctionName, setProfessionalFunctionName] = useState("");
  const [professionalFunctionMessage, setProfessionalFunctionMessage] = useState("");
  const [logoPath, setLogoPath] = useState(props.organization.logo_path ?? "");
  const location = props.locations.find((item) => item.active) ?? props.locations[0];
  const address = (location?.address ?? {}) as Record<string, string>;

  async function copyLink(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage("Link copiado.");
    } catch {
      setMessage("Não foi possível copiar automaticamente. Selecione e copie o link manualmente.");
    }
  }

  async function saveOrganization(event: FormEvent<HTMLFormElement>, closeDeadlineEditor = false) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const rawWhatsApp = String(data.get("public_contact_phone_e164") ?? "").trim();
    const publicContactPhone = rawWhatsApp ? normalizePhoneE164(rawWhatsApp) : null;
    if (rawWhatsApp && !publicContactPhone) {
      setMessage("Informe um WhatsApp válido.");
      return;
    }
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("update_organization_settings", {
        p_organization_id: props.organizationId,
        p_name: String(data.get("name") ?? "").trim(),
        p_slug: String(data.get("slug") ?? "").trim().toLowerCase(),
        p_public_contact_phone_e164: publicContactPhone,
        p_logo_path: logoPath || null,
        p_cancellation_lead_minutes: Math.max(0, Number(data.get("cancellation_lead_minutes") ?? props.organization.cancellation_lead_minutes ?? 0)),
      }));
    }, "Regras da organização atualizadas.");
    if (saved) {
      if (closeDeadlineEditor) setRulesEditor(null);
      router.refresh();
    }
  }

  async function uploadLogo(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/u.test(file.type) || file.size > 2 * 1024 * 1024) {
      setMessage("Logo deve ser PNG, JPEG ou WebP de até 2 MB.");
      return;
    }
    const path = `${props.organizationId}/logo-${crypto.randomUUID()}`;
    const { error } = await connectedClient().storage.from("organization-logos").upload(path, file, { upsert: true, contentType: file.type, cacheControl: "3600" });
    if (error) { setMessage(error.message); return; }
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().from("organizations").update({ logo_path: path }).eq("id", props.organizationId));
    }, "Logo atualizada.");
    if (saved) {
      setLogoPath(path);
      router.refresh();
    }
  }

  async function saveLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const payload = {
      organization_id: props.organizationId,
      name: String(data.get("name") ?? "").trim(),
      address: {
        street: String(data.get("street") ?? "").trim(),
        number: String(data.get("number") ?? "").trim(),
        complement: String(data.get("complement") ?? "").trim(),
        district: String(data.get("district") ?? "").trim(),
        city: String(data.get("city") ?? "").trim(),
        state: String(data.get("state") ?? "").trim().toUpperCase(),
        postal_code: String(data.get("postal_code") ?? "").trim(),
      },
      active: true,
    };
    const saved = await runMutation(setMessage, async () => {
      const client = connectedClient();
      await assertResult(location
        ? await client.from("locations").update(payload).eq("id", location.id).eq("organization_id", props.organizationId)
        : await client.from("locations").insert(payload));
    }, "Unidade atualizada.");
    if (saved) router.refresh();
  }

  const activeLocationId = location?.id ?? "";
  const environments = (props.environments ?? [])
    .filter((item) => item.location_id === activeLocationId)
    .sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name));
  const activeEnvironmentCount = environments.filter((environment) => environment.active).length;
  const professionalFunctions = props.professionalFunctions ?? [];
  const professionalFunctionsAvailable = props.professionalFunctionsAvailable ?? true;

  async function addEnvironment() {
    const name = environmentName.trim();
    if (!activeLocationId) { setMessage("Cadastre uma unidade ativa antes dos ambientes."); return; }
    if (!name) { setMessage("Informe o nome do ambiente."); return; }
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().from("agenda_environments").insert({
        organization_id: props.organizationId,
        location_id: activeLocationId,
        name,
        sort_order: environments.length ? Math.max(...environments.map((item) => item.sort_order)) + 1 : 1,
        active: true,
      }));
    }, "Ambiente adicionado.");
    if (saved) { setEnvironmentName(""); router.refresh(); }
  }

  async function updateEnvironment(id: string, payload: Record<string, unknown>, success: string) {
    const saved = await runMutation(setMessage, async () => {
      if ("sort_order" in payload) {
        await assertResult(await connectedClient().rpc("reorder_agenda_environment", { p_environment_id: id, p_sort_order: Number(payload.sort_order) }));
      } else {
        await assertResult(await connectedClient().from("agenda_environments").update(payload).eq("id", id).eq("organization_id", props.organizationId));
      }
    }, success);
    if (saved) router.refresh();
  }

  async function addProfessionalFunction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = professionalFunctionName.trim();
    if (name.length < 2) {
      setProfessionalFunctionMessage("Informe uma função com pelo menos 2 caracteres.");
      return;
    }
    const saved = await runMutation(setProfessionalFunctionMessage, async () => {
      const result = await connectedClient().from("professional_functions").insert({
        organization_id: props.organizationId,
        name,
      });
      await assertResult(result);
    }, "Função cadastrada.");
    if (saved) {
      setProfessionalFunctionName("");
      router.refresh();
    }
  }

  async function connectMercadoPago() {
    setConnecting(true);
    setMessage("Abrindo autorização segura do Mercado Pago…");
    try {
      const { data, error } = await connectedClient().functions.invoke("mercado-pago-oauth-start", {
        body: { organizationId: props.organizationId, returnPath: "/gestor/configuracoes" },
      });
      const authorizationUrl = data && typeof data === "object" && "authorizationUrl" in data ? data.authorizationUrl : null;
      if (error || typeof authorizationUrl !== "string") throw new Error(error?.message ?? "URL de autorização não recebida.");
      window.location.assign(authorizationUrl);
    } catch (error) {
      setConnecting(false);
      setMessage(humanizeError(error));
    }
  }

  async function exportRetentionData() {
    if (props.billingStatus !== "CANCELED_RETENTION") return;
    setExporting(true);
    setMessage("Preparando exportação real…");
    try {
      const result = await connectedClient().rpc("export_organization_data", { p_organization_id: props.organizationId });
      if (result.error) {
        if (/does not exist|could not find the function|schema cache/i.test(result.error.message)) {
          throw new Error("Exportação ainda não está disponível no backend. A RPC export_organization_data precisa ser publicada antes do fim da retenção.");
        }
        throw new Error(result.error.message);
      }
      const url = URL.createObjectURL(new Blob([JSON.stringify(result.data, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `los-barberos-export-${props.organization.slug}-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage("Exportação JSON concluída.");
    } catch (error) {
      setMessage(humanizeError(error));
    } finally {
      setExporting(false);
    }
  }

  const mpConnected = props.merchant?.status === "CONNECTED";
  const whatsappConnected = props.whatsapp?.connections.some((connection) =>
    connection.is_active && connection.status === "CONNECTED" &&
    (!connection.health_status || connection.health_status === "OK")
  ) ?? false;

  if (props.billingStatus === "CANCELED_RETENTION" || props.billingStatus === "CLOSED") {
    return <div className={styles.stack}>
      <PageHeader title="Exportação e retenção" description="A operação foi encerrada; somente recuperação de cobrança e exportação permanecem disponíveis." />
      <ActionMessage message={message} />
      <Panel title="Dados da organização" description={props.billingStatus === "CANCELED_RETENTION" ? "Exportação disponível durante a janela de retenção." : "A janela terminou e os dados não obrigatórios foram anonimizados."}>
        <div className={styles.integration}><div className={styles.integrationInfo}><strong>Exportação JSON da organização</strong><p>Gerada pelo backend sob autorização; nunca inclui segredos dos provedores.</p></div><button className={styles.button} disabled={props.billingStatus !== "CANCELED_RETENTION" || exporting} type="button" onClick={exportRetentionData}>{exporting ? "Gerando…" : props.billingStatus === "CLOSED" ? "Janela encerrada" : "Baixar dados"}</button></div>
        <Link className={`${styles.button} ${styles.buttonSoft}`} href="/regularizacao">Abrir cobrança e plano</Link>
      </Panel>
    </div>;
  }

  return <div className={`${styles.stack} queue-print-root`}>
    <PageHeader title="Configurações" description="Regras, unidade e estados reais das integrações." />
    <ActionMessage message={message} />
    <div className={styles.grid}>
      {props.organization.queue_public_id &&
        <Panel title="Links úteis" description="Acesse, compartilhe e imprima os links públicos da sua barbearia." className={styles.span7}>
          <div className="useful-links">
            <article className="useful-link-row">
              <div><strong>Link do gerenciador de fila</strong><p>Você pode imprimir o QRcode do gerenciador de fila para seus clientes escanearem.</p></div>
              <button type="button" className="useful-link-value" onClick={() => void copyLink(queueUrl)} title="Copiar link da fila">{queueUrl}</button>
              <div className="useful-link-actions"><button type="button" className="button button--soft" onClick={() => void copyLink(queueUrl)}>Copiar link</button><button type="button" className="button button--soft" onClick={() => window.print()}>Imprimir QR code</button></div>
            </article>
            <article className="useful-link-row">
              <div><strong>Link de agendamento</strong><p>Envie este link para clientes novos e antigos, eles poderão fazer cadastro/login e acessar a Agenda da sua barbearia.</p></div>
              <button type="button" className="useful-link-value" onClick={() => void copyLink(bookingUrl)} title="Copiar link de agendamento">{bookingUrl}</button>
              <div className="useful-link-actions"><button type="button" className="button button--soft" onClick={() => void copyLink(bookingUrl)}>Copiar link</button></div>
            </article>
            <article className="useful-link-row">
              <div><strong>Acesso ao App do Barbeiro</strong><p>Envie este link para o profissional acessar a agenda e o caixa da barbearia.</p></div>
              <button type="button" className="useful-link-value" onClick={() => void copyLink(barberAccessUrl)} title="Copiar link do App do Barbeiro">{barberAccessUrl}</button>
              <div className="useful-link-actions"><button type="button" className="button button--soft" onClick={() => void copyLink(barberAccessUrl)}>Copiar link</button><Link className="button button--soft" href={barberAccessPath}>Abrir app</Link></div>
            </article>
          </div>
        </Panel>}
      <Panel title="Regras de negócio" description="Prazo aplicado a novos agendamentos, assinaturas e pagamentos online." className={styles.span5}>
        <div className={styles.list}>
          <article className={styles.integration}>
            <div className={styles.integrationInfo}><strong>Prazo Limite</strong><p>{props.organization.cancellation_lead_minutes ? `${props.organization.cancellation_lead_minutes} minutos antes do horário` : "Sem limite de cancelamento"}</p></div>
            <button type="button" className={`${styles.button} ${styles.buttonSoft}`} aria-label="Editar prazo limite" onClick={() => setRulesEditor("deadline")}><Pencil size={15} /> Editar prazo limite</button>
          </article>
          <article className={styles.integration}>
            <div className={styles.integrationInfo}><strong>Ambientes da agenda</strong><p>{activeEnvironmentCount} ativos · Colunas físicas da agenda</p></div>
            <button type="button" className={`${styles.button} ${styles.buttonSoft}`} aria-label="Editar ambientes da agenda" onClick={() => setRulesEditor("environments")}><Pencil size={15} /> Editar ambientes</button>
          </article>
          <article className={styles.integration}>
            <div className={styles.integrationInfo}><strong>Cadastro de Funções</strong><p>{professionalFunctionsAvailable ? `${professionalFunctions.length} ${professionalFunctions.length === 1 ? "função cadastrada" : "funções cadastradas"} · Cargos exercidos pelos profissionais` : "Cadastro indisponível até a atualização do banco."}</p></div>
            <button type="button" className={`${styles.button} ${styles.buttonSoft}`} aria-label="Editar cadastro de funções" onClick={() => { setProfessionalFunctionMessage(""); setRulesEditor("functions"); }}><Pencil size={15} /> Editar</button>
          </article>
        </div>
      </Panel>
      <Panel title="Dados da Barbearia" className={styles.span7}>
        <form className={styles.form} onSubmit={saveOrganization}>
          <Field label="Nome"><input name="name" required minLength={2} defaultValue={props.organization.name} /></Field>
          <Field label="Nome de usuário"><input name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" defaultValue={props.organization.slug} /></Field>
          <Field label="E-mail"><input value={props.accountEmail ?? "Não disponível"} readOnly aria-readonly="true" /></Field>
          <Field label="WhatsApp público"><input name="public_contact_phone_e164" inputMode="tel" placeholder="11999999999 ou +5511999999999" pattern="[+0-9][0-9\s().-]{7,20}" defaultValue={props.organization.public_contact_phone_e164 ?? ""} onBlur={(event) => { const normalized = normalizePhoneE164(event.currentTarget.value); if (normalized) event.currentTarget.value = normalized; }} /></Field>
          <Field label="Logomarca"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadLogo(event.target.files?.[0])} /><small>{logoPath ? "Logo cadastrada" : "PNG, JPEG ou WebP até 2 MB"}</small></Field>
          <button className={`${styles.button} ${styles.formWide}`} type="submit">Salvar regras</button>
        </form>
      </Panel>
      <Panel title="Unidade" description="Uma unidade ativa no MVP" className={styles.span5}>
        <form className={styles.form} onSubmit={saveLocation}>
          <Field label="Nome" wide><input name="name" required minLength={2} defaultValue={location?.name ?? "Unidade principal"} /></Field>
          <Field label="Rua"><input name="street" defaultValue={address.street ?? ""} /></Field><Field label="Número"><input name="number" defaultValue={address.number ?? ""} /></Field>
          <Field label="Complemento"><input name="complement" defaultValue={address.complement ?? ""} /></Field><Field label="Bairro"><input name="district" defaultValue={address.district ?? ""} /></Field>
          <Field label="Cidade"><input name="city" defaultValue={address.city ?? ""} /></Field><Field label="UF"><input name="state" maxLength={2} defaultValue={address.state ?? ""} /></Field>
          <Field label="CEP" wide><input name="postal_code" inputMode="numeric" defaultValue={address.postal_code ?? ""} /></Field>
          <button className={`${styles.button} ${styles.formWide}`} type="submit">Salvar unidade</button>
        </form>
      </Panel>
    </div>
    {props.organization.queue_public_id && <section className="queue-print-sheet" aria-label="Folha de impressão da fila presencial">
      <div className="queue-print-sheet__logo" aria-label="Logo Los Barberos">LB</div>
      <h1>{props.organization.name}</h1>
      <QRCodeSVG data-testid="queue-print-qr" value={queueUrl} size={520} level="M" includeMargin />
      <p className="queue-print-sheet__instruction">Chegou agora? Verifique a fila de espera e faça sua reserva</p>
      <p className="queue-print-sheet__thanks">Agradecemos sua preferência</p>
    </section>}
    <Panel title="Integrações" description="Apenas IDs e estados públicos são exibidos; tokens ficam no Vault.">
      <div className={styles.list}>
        <article className={styles.integration}><div className={styles.integrationInfo}><span className={styles.toolbarGroup}><strong>Gerenciar minha assinatura</strong><StatusChip active={["TRIALING", "ACTIVE", "GRACE"].includes(props.subscription?.status ?? "")} label={props.subscription?.status ?? "NÃO INICIADO"} /></span><p>Assinatura, trial, carência e cobrança geridos pelo Stripe.</p></div><span className={styles.toolbarGroup}><Link className={`${styles.button} ${styles.buttonSoft}`} href="/regularizacao">Abrir cobrança</Link><Link className={`${styles.button} ${styles.buttonSoft}`} href="/gestor/configuracoes/modulos">Módulos</Link></span></article>
        <article className={styles.integration}><div className={styles.integrationInfo}><span className={styles.toolbarGroup}><strong>Mercado Pago</strong><StatusChip active={mpConnected} label={props.merchant?.status ?? "NÃO CONECTADO"} /></span><p>{props.merchant?.external_account_id ? `Conta ${props.merchant.external_account_id}` : "OAuth por tenant; credenciais nunca chegam ao navegador."}</p></div><button className={styles.button} type="button" onClick={connectMercadoPago} disabled={connecting}>{connecting ? "Abrindo…" : mpConnected ? "Reconectar" : "Conectar conta"}</button></article>
        <article className={styles.integration}><div className={styles.integrationInfo}><span className={styles.toolbarGroup}><strong>WhatsApp</strong><StatusChip active={whatsappConnected} label={whatsappConnected ? "CONECTADO" : "PENDENTE"} /></span><p>{whatsappConnected ? "Integração ativa para confirmações, lembretes e ações seguras." : "Configure Meta Cloud API ou QR Web na página exclusiva da integração."}</p></div><Link className={`${styles.button} ${styles.buttonSoft}`} href="/gestor/configuracoes/whatsapp">Abrir integração</Link></article>
      </div>
    </Panel>
    {rulesEditor === "deadline" && <div className="modal-layer" role="presentation"><button className="modal-layer__backdrop" type="button" aria-label="Fechar edição do prazo limite" onClick={() => setRulesEditor(null)} /><form className="form-modal" role="dialog" aria-modal="true" aria-label="Editar prazo limite" onSubmit={(event) => void saveOrganization(event, true)}>
      <div className="form-modal__head"><span><small>Regras de negócio</small><strong>Prazo Limite</strong></span><button type="button" className="icon-button" onClick={() => setRulesEditor(null)} aria-label="Fechar edição do prazo limite"><X size={19} /></button></div>
      <div className="form-modal__body">
        <input type="hidden" name="name" value={props.organization.name} readOnly />
        <input type="hidden" name="slug" value={props.organization.slug} readOnly />
        <input type="hidden" name="public_contact_phone_e164" value={props.organization.public_contact_phone_e164 ?? ""} readOnly />
        <div className={styles.deadlineEditorField}>
          <Field label="Prazo Limite (minutos)">
            <input name="cancellation_lead_minutes" type="number" min="0" step="1" defaultValue={props.organization.cancellation_lead_minutes ?? 0} placeholder="Adicione o prazo limite em minutos" />
            <small>Em 0, não há limite: a sessão cancelada retorna para Em aberto.</small>
          </Field>
          <button type="button" className={`${styles.button} ${styles.buttonSoft}`} aria-label="Ajuda sobre prazo limite" onClick={() => setRulesHelpOpen(true)}><CircleHelp size={15} /> Como funciona</button>
        </div>
      </div>
      <div className="form-modal__footer"><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => setRulesEditor(null)}>Cancelar</button><button className={styles.button} type="submit">Salvar prazo</button></div>
    </form></div>}
    {rulesEditor === "environments" && <div className="modal-layer" role="presentation"><button className="modal-layer__backdrop" type="button" aria-label="Fechar edição dos ambientes" onClick={() => setRulesEditor(null)} /><section className="form-modal" role="dialog" aria-modal="true" aria-label="Editar ambientes da agenda">
      <div className="form-modal__head"><span><small>Regras de negócio</small><strong>Ambientes da agenda</strong></span><button type="button" className="icon-button" onClick={() => setRulesEditor(null)} aria-label="Fechar edição dos ambientes"><X size={19} /></button></div>
      <div className="form-modal__body">
        <p className={styles.muted}>Organize as colunas físicas usadas na agenda desta unidade.</p>
        <div className={styles.sectionHeader}><span className={styles.muted}>{activeEnvironmentCount} ambientes ativos</span></div>
        {environments.length === 0 && <p className={styles.muted}>Nenhum ambiente cadastrado nesta unidade.</p>}
        <div className={styles.list}>
          {environments.map((environment) => <div className={styles.agendaEnvironmentRow} key={environment.id}>
            <label className={styles.field}><span>Nome</span><input defaultValue={environment.name} onBlur={(event) => { const value = event.currentTarget.value.trim(); if (value && value !== environment.name) void updateEnvironment(environment.id, { name: value }, "Ambiente atualizado."); }} /></label>
            <label className={styles.field}><span>Ordem</span><input type="number" min="1" defaultValue={environment.sort_order} onBlur={(event) => { const value = Math.max(1, Number(event.currentTarget.value || environment.sort_order)); if (value !== environment.sort_order) void updateEnvironment(environment.id, { sort_order: value }, "Ordem dos ambientes atualizada."); }} /></label>
            <StatusChip active={environment.active} />
            <button className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} type="button" onClick={() => void updateEnvironment(environment.id, { active: !environment.active }, environment.active ? "Ambiente inativado." : "Ambiente reativado.")}>{environment.active ? "Inativar" : "Ativar"}</button>
          </div>)}
        </div>
        <div className={styles.toolbarGroup}><input aria-label="Nome do novo ambiente" value={environmentName} onChange={(event) => setEnvironmentName(event.target.value)} placeholder="Nome do novo ambiente" /><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => void addEnvironment()}>Adicionar ambiente</button></div>
        {(props.environmentIssues ?? []).length > 0 && <div className={styles.noticeWarning}><strong>Pendências de alocação</strong><p>{(props.environmentIssues ?? []).length} registro(s) legado(s) precisam de revisão antes de novas reservas físicas.</p></div>}
      </div>
      <div className="form-modal__footer"><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => setRulesEditor(null)}>Concluir</button></div>
    </section></div>}
    {rulesEditor === "functions" && <div className="modal-layer" role="presentation"><button className="modal-layer__backdrop" type="button" aria-label="Fechar cadastro de funções" onClick={() => setRulesEditor(null)} /><section className="form-modal" role="dialog" aria-modal="true" aria-label="Cadastro de Funções">
      <div className="form-modal__head"><span><small>Regras de negócio</small><strong>Cadastro de Funções</strong></span><button type="button" className="icon-button" onClick={() => setRulesEditor(null)} aria-label="Fechar cadastro de funções"><X size={19} /></button></div>
      <div className="form-modal__body">
        <p className={styles.muted}>Função refere-se ao cargo exercido pelo profissional na empresa.</p>
        {!professionalFunctionsAvailable && <div className={styles.noticeWarning}><strong>Cadastro indisponível</strong><p>Cadastro indisponível até a atualização do banco. Aplique as migrations pendentes e recarregue a tela.</p></div>}
        <form className={styles.professionalFunctionForm} onSubmit={(event) => void addProfessionalFunction(event)}>
          <Field label="Adicionar a Função"><input value={professionalFunctionName} onChange={(event) => setProfessionalFunctionName(event.target.value)} minLength={2} maxLength={80} required disabled={!professionalFunctionsAvailable} placeholder="Ex.: Barbeiro" /></Field>
          <button className={`${styles.button} ${styles.buttonSoft}`} type="submit" disabled={!professionalFunctionsAvailable}>Adicionar função</button>
        </form>
        {professionalFunctionMessage && <p className={styles.message} role="status">{professionalFunctionMessage}</p>}
        {professionalFunctions.length === 0
          ? <p className={styles.muted}>Nenhuma função cadastrada.</p>
          : <ul className={styles.professionalFunctionList} aria-label="Funções cadastradas">
            {professionalFunctions.map((item) => <li className={styles.professionalFunctionItem} key={item.id}>{item.name}</li>)}
          </ul>}
      </div>
      <div className="form-modal__footer"><button className={`${styles.button} ${styles.buttonSoft}`} type="button" onClick={() => setRulesEditor(null)}>Concluir</button></div>
    </section></div>}
    {rulesHelpOpen && <div className="modal-layer" role="presentation"><button className="modal-layer__backdrop" type="button" aria-label="Fechar ajuda" onClick={() => setRulesHelpOpen(false)} /><section className="form-modal" role="dialog" aria-modal="true" aria-label="Ajuda do prazo limite"><div className="form-modal__head"><span><small>Regras de negócio</small><strong>Prazo Limite</strong></span><button type="button" className="icon-button" onClick={() => setRulesHelpOpen(false)} aria-label="Fechar"><X size={19} /></button></div><div className="form-modal__body"><p>Define quantos minutos antes do horário o cancelamento permanece dentro do prazo. O valor vale para novos agendamentos, assinaturas e pagamentos online. Com 0, não há limite: a sessão volta para Em aberto.</p></div><div className="form-modal__footer"><button type="button" className="button button--dark" onClick={() => setRulesHelpOpen(false)}>Entendi</button></div></section></div>}
  </div>;
}
