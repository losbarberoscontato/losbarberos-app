"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { PageHeader } from "@/components/ui";
import { ActionMessage, Field, Panel, StatusChip } from "./shared";
import { assertResult, connectedClient, runMutation } from "./mutation-utils";
import styles from "./connected-manager.module.css";

export type WhatsAppConnection = {
  id: string;
  provider: "META_CLOUD" | "QR_WEB";
  status: "PENDING" | "WAITING_FOR_QR" | "CONNECTED" | "REAUTH_REQUIRED" | "DISCONNECTED" | "ERROR";
  is_active: boolean;
  waba_id: string | null;
  phone_number_id: string | null;
  gateway_instance_id: string | null;
  connected_at: string | null;
  disconnected_at: string | null;
  last_error_code: string | null;
  last_status_at: string | null;
};

export type WhatsAppSettingsStatus = {
  connections: WhatsAppConnection[];
  reminders: Array<{
    id: string;
    position: number;
    enabled: boolean;
    offset_minutes: number;
    template_key: "appointment_reminder_6h" | "appointment_reminder_45m";
    language_code: string;
  }>;
  automation: {
    confirmation_enabled: boolean;
    confirmation_template_key: string;
    welcome_enabled: boolean;
    welcome_message: string;
  };
};

type Props = {
  organizationId: string;
  organizationName: string;
  status: WhatsAppSettingsStatus;
  schemaReady?: boolean;
};

const providerLabels = {
  META_CLOUD: "Meta Cloud API",
  QR_WEB: "QR Web",
} as const;

function connectionLabel(connection: WhatsAppConnection | undefined) {
  if (!connection) return "NÃO CONFIGURADO";
  if (connection.status === "CONNECTED") return connection.is_active ? "ATIVO" : "CONECTADO";
  if (connection.status === "WAITING_FOR_QR") return "AGUARDANDO QR";
  if (connection.status === "REAUTH_REQUIRED") return "REAUTENTICAÇÃO";
  return connection.status;
}

function formatOffset(minutes: number) {
  if (minutes % 60 === 0) return `${minutes / 60}h antes`;
  return `${minutes} min antes`;
}

export function WhatsAppSettings({ organizationId, organizationName, status, schemaReady = true }: Props) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busyProvider, setBusyProvider] = useState<"META_CLOUD" | "QR_WEB" | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [reminders, setReminders] = useState(status.reminders);
  const [welcomeMessage, setWelcomeMessage] = useState(status.automation.welcome_message);

  const connectionByProvider = new Map(status.connections.map((connection) => [connection.provider, connection]));

  async function startConnection(provider: "META_CLOUD" | "QR_WEB") {
    setBusyProvider(provider);
    try {
      const result = await connectedClient().functions.invoke(
        provider === "META_CLOUD" ? "whatsapp-embedded-signup-start" : "whatsapp-qr-start",
        { body: { organizationId, returnPath: "/gestor/configuracoes/whatsapp" } },
      );
      if (result.error) throw result.error;
      const data = result.data as { authorizationUrl?: string; qrCode?: string | null } | null;
      if (provider === "META_CLOUD" && data?.authorizationUrl) {
        window.open(data.authorizationUrl, "los-barberos-whatsapp", "noopener,noreferrer");
        setMessage("A janela segura da Meta foi aberta para concluir a conexão.");
      } else {
        setQrCode(data?.qrCode ?? null);
        setMessage(data?.qrCode ? "Escaneie o QR Code no WhatsApp Business do gestor." : "QR gerado; aguardando o gateway.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível iniciar a conexão.");
    } finally {
      setBusyProvider(null);
    }
  }

  async function saveAutomation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = await runMutation(setMessage, async () => {
      const client = connectedClient();
      await assertResult(await client.from("whatsapp_automation_settings").update({
        welcome_message: welcomeMessage.trim(),
      }).eq("organization_id", organizationId));
      await assertResult(await client.rpc("save_whatsapp_reminder_rules", {
        p_organization_id: organizationId,
        p_rules: reminders.map((rule) => ({
          position: rule.position,
          enabled: rule.enabled,
          offset_minutes: rule.offset_minutes,
          template_key: rule.template_key,
          language_code: rule.language_code,
        })),
      }));
    }, "Mensagens automáticas atualizadas.");
    if (saved) setMessage("Mensagens automáticas atualizadas.");
  }

  async function setActive(connection: WhatsAppConnection) {
    const saved = await runMutation(setMessage, async () => {
      const client = connectedClient();
      await assertResult(await client.rpc("set_whatsapp_active_provider", {
        p_organization_id: organizationId,
        p_connection_id: connection.id,
      }));
    }, "Canal ativo atualizado.");
    if (saved) router.refresh();
  }

  async function disconnect(connection: WhatsAppConnection) {
    const saved = await runMutation(setMessage, async () => {
      const client = connectedClient();
      await assertResult(await client.rpc("disconnect_whatsapp_connection", {
        p_organization_id: organizationId,
        p_connection_id: connection.id,
      }));
    }, "Canal desconectado.");
    if (saved) router.refresh();
  }

  return <div className={`${styles.stack} settings-page`}>
    <PageHeader title="WhatsApp" description={`Conecte o WhatsApp da ${organizationName} e automatize avisos transacionais.`} />
    <ActionMessage message={message} />
    {!schemaReady && <p className={styles.message}>A estrutura conectada desta integração ainda aguarda a migration remota. A tela está pronta, mas salvar e conectar ficará disponível após a aplicação autorizada.</p>}

    <section className={styles.whatsappHero} aria-labelledby="whatsapp-title">
      <div>
        <span className={styles.whatsappEyebrow}>INTEGRAÇÃO POR BARBEARIA</span>
        <h1 id="whatsapp-title">WhatsApp da sua operação</h1>
        <p>Escolha um canal, acompanhe a conexão e envie confirmações e lembretes com consentimento do cliente.</p>
      </div>
      <StatusChip active={status.connections.some((connection) => connection.is_active && connection.status === "CONNECTED")} label={status.connections.some((connection) => connection.is_active) ? "CANAL SELECIONADO" : "AGUARDANDO CONEXÃO"} />
    </section>

    <Panel title="Escolha como conectar" description="Apenas um canal fica ativo por vez. As credenciais ficam protegidas no servidor e no Vault.">
      <div className={styles.providerGrid}>
        {(["META_CLOUD", "QR_WEB"] as const).map((provider) => {
          const connection = connectionByProvider.get(provider);
          const isMeta = provider === "META_CLOUD";
          return <article className={`${styles.providerCard} ${connection?.is_active ? styles.providerCardActive : ""}`} key={provider}>
            <div className={styles.providerCardTop}>
              <div className={styles.providerIcon}>{isMeta ? "M" : "QR"}</div>
              <StatusChip active={connection?.status === "CONNECTED"} label={connectionLabel(connection)} />
            </div>
            <h3>{providerLabels[provider]}</h3>
            <p>{isMeta ? "Canal oficial da Meta, com Embedded Signup e templates aprovados." : "Gateway Evolution API em VPS dedicado. Canal não oficial, sujeito a restrições do WhatsApp."}</p>
            {connection?.phone_number_id && <small>Phone Number ID: {connection.phone_number_id}</small>}
            {connection?.gateway_instance_id && <small>Instância: {connection.gateway_instance_id}</small>}
            <div className={styles.rowActions}>
              <button className={styles.button} type="button" onClick={() => void startConnection(provider)} disabled={busyProvider !== null || !schemaReady}>
                {busyProvider === provider ? "Iniciando…" : connection?.status === "CONNECTED" ? "Reconectar" : isMeta ? "Conectar Meta" : "Gerar QR"}
              </button>
              {connection?.status === "CONNECTED" && <>
                {!connection.is_active && <button className={styles.buttonSoft} type="button" onClick={() => void setActive(connection)} disabled={!schemaReady}>Ativar</button>}
                <button className={styles.buttonSoft} type="button" onClick={() => void disconnect(connection)} disabled={!schemaReady}>Desconectar</button>
              </>}
            </div>
          </article>;
        })}
      </div>
      <div className={styles.rowActions}>
        <button className={styles.buttonSoft} type="button" onClick={() => router.refresh()} disabled={!schemaReady}>Atualizar status</button>
      </div>
      <div className={styles.whatsappSteps} aria-label="Etapas da conexão">
        <span><strong>1</strong> Escolha o canal</span>
        <span><strong>2</strong> Autorize a conexão</span>
        <span><strong>3</strong> Aguarde a confirmação</span>
      </div>
      {qrCode && <div className={styles.qrConnection}>
        <div><strong>Escaneie com o WhatsApp Business</strong><p>Abra Aparelhos conectados no celular do gestor e leia este código.</p></div>
        <img src={qrCode.startsWith("data:") ? qrCode : `data:image/png;base64,${qrCode}`} alt="QR Code temporário para conectar o WhatsApp" />
      </div>}
      <p className={styles.providerNotice}>O QR Web exige VPS e manutenção do gateway. A Meta Cloud API exige configuração de aplicativo, WABA, templates e credenciais server-side.</p>
    </Panel>

    <Panel title="Mensagens automáticas" description="Confirmação, lembretes e boas-vindas com textos controlados por barbearia.">
      <form onSubmit={saveAutomation} className={styles.stack}>
        <div className={styles.automationList}>
          <div className={styles.automationRow}><div><strong>Confirmação do agendamento</strong><small>Enviada quando o cliente confirma a reserva.</small></div><StatusChip active={status.automation.confirmation_enabled} label="TEMPLATE" /></div>
          {reminders.map((rule, index) => <div className={styles.automationRow} key={rule.id}>
            <div><strong>{index === 0 ? "Lembrete 6 horas antes" : "Lembrete 45 minutos antes"}</strong><small>{formatOffset(rule.offset_minutes)} · template utilitário</small></div>
            <label className={styles.check}><input type="checkbox" checked={rule.enabled} disabled={!schemaReady} onChange={(event) => setReminders((current) => current.map((item) => item.id === rule.id ? { ...item, enabled: event.target.checked } : item))} /> Ativo</label>
          </div>)}
        </div>
        <Field label="Mensagem de boas-vindas" wide>
          <textarea aria-label="Mensagem de boas-vindas" value={welcomeMessage} disabled={!schemaReady} onChange={(event) => setWelcomeMessage(event.target.value)} maxLength={1024} />
        </Field>
        <small className={styles.muted}>Variáveis permitidas: &#123;nome&#125;, &#123;barbearia&#125; e &#123;link&#125;. Não inclua tokens ou dados sensíveis.</small>
        <div className={styles.rowActions}><button className={styles.button} type="submit" disabled={!schemaReady}>Salvar automações</button></div>
      </form>
    </Panel>
  </div>;
}
