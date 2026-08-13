"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui";
import type { loadSettingsData } from "./server";
import type { AwaitedReturn } from "./utility-types";
import { humanizeError } from "./format";
import { ActionMessage, Field, Panel, StatusChip } from "./shared";
import { assertResult, connectedClient, runMutation } from "./mutation-utils";
import styles from "./connected-manager.module.css";

type Props = AwaitedReturn<typeof loadSettingsData>;

export function SettingsManager(props: Props) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const location = props.locations.find((item) => item.active) ?? props.locations[0];
  const address = (location?.address ?? {}) as Record<string, string>;

  async function saveOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().from("organizations").update({
        name: String(data.get("name") ?? "").trim(),
        slug: String(data.get("slug") ?? "").trim().toLowerCase(),
        timezone: String(data.get("timezone")),
        deposit_bps: Math.round(Number(data.get("deposit_percent")) * 100),
        cancellation_lead_minutes: Math.round(Number(data.get("cancellation_hours")) * 60),
        slot_interval_minutes: Number(data.get("slot_interval_minutes")),
        hold_duration_minutes: Number(data.get("hold_duration_minutes")),
        commission_frequency: String(data.get("commission_frequency")),
      }).eq("id", props.organizationId));
    }, "Regras da organização atualizadas.");
    if (saved) router.refresh();
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
  const whatsappConfigured = false;

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

  return <div className={styles.stack}>
    <PageHeader title="Configurações" description="Regras, unidade e estados reais das integrações." />
    <ActionMessage message={message} />
    <div className={styles.grid}>
      <Panel title="Regras da barbearia" description="Valores usados para novos agendamentos" className={styles.span7}>
        <form className={styles.form} onSubmit={saveOrganization}>
          <Field label="Nome"><input name="name" required minLength={2} defaultValue={props.organization.name} /></Field>
          <Field label="Slug público"><input name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" defaultValue={props.organization.slug} /></Field>
          <Field label="Timezone"><select name="timezone" defaultValue={props.organization.timezone}><option value="America/Sao_Paulo">America/Sao_Paulo</option><option value="America/Manaus">America/Manaus</option><option value="America/Fortaleza">America/Fortaleza</option><option value="America/Recife">America/Recife</option><option value="America/Bahia">America/Bahia</option><option value="America/Cuiaba">America/Cuiaba</option><option value="America/Rio_Branco">America/Rio_Branco</option></select></Field>
          <Field label="Sinal (%)"><input name="deposit_percent" type="number" min={0} max={100} step="0.01" defaultValue={props.organization.deposit_bps / 100} /></Field>
          <Field label="Prazo de cancelamento (horas)"><input name="cancellation_hours" type="number" min={0} step="1" defaultValue={props.organization.cancellation_lead_minutes / 60} /></Field>
          <Field label="Intervalo dos slots"><select name="slot_interval_minutes" defaultValue={15}><option value="15">15 minutos</option></select></Field>
          <Field label="Duração do hold"><input name="hold_duration_minutes" type="number" min={2} max={30} defaultValue={props.organization.hold_duration_minutes} /></Field>
          <Field label="Frequência das comissões"><select name="commission_frequency" defaultValue={props.organization.commission_frequency}><option value="DAILY">Diária</option><option value="WEEKLY">Semanal</option><option value="MONTHLY">Mensal</option></select></Field>
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
    <Panel title="Integrações" description="Apenas IDs e estados públicos são exibidos; tokens ficam no Vault.">
      <div className={styles.list}>
        <article className={styles.integration}><div className={styles.integrationInfo}><span className={styles.toolbarGroup}><strong>Stripe Billing</strong><StatusChip active={["TRIALING", "ACTIVE", "GRACE"].includes(props.subscription?.status ?? "")} label={props.subscription?.status ?? "NÃO INICIADO"} /></span><p>Assinatura, trial, carência e cobrança geridos pelo Stripe.</p></div><Link className={`${styles.button} ${styles.buttonSoft}`} href="/regularizacao">Abrir cobrança</Link></article>
        <article className={styles.integration}><div className={styles.integrationInfo}><span className={styles.toolbarGroup}><strong>Mercado Pago</strong><StatusChip active={mpConnected} label={props.merchant?.status ?? "NÃO CONECTADO"} /></span><p>{props.merchant?.external_account_id ? `Conta ${props.merchant.external_account_id}` : "OAuth por tenant; credenciais nunca chegam ao navegador."}</p></div><button className={styles.button} type="button" onClick={connectMercadoPago} disabled={connecting}>{connecting ? "Abrindo…" : mpConnected ? "Reconectar" : "Conectar conta"}</button></article>
        <article className={styles.integration}><div className={styles.integrationInfo}><span className={styles.toolbarGroup}><strong>WhatsApp</strong><StatusChip active={whatsappConfigured} label="PENDENTE" /></span><p>Configure Meta Cloud API ou QR Web na página exclusiva da integração.</p></div><Link className={`${styles.button} ${styles.buttonSoft}`} href="/gestor/configuracoes/whatsapp">Abrir integração</Link></article>
      </div>
    </Panel>
  </div>;
}
