"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { PageHeader } from "@/components/ui";
import { normalizePhoneE164 } from "@/lib/phone";
import { ActionMessage, Field, Panel, StatusChip } from "./shared";
import { assertResult, connectedClient, runMutation } from "./mutation-utils";
import { humanizeError } from "./format";
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
  connection_epoch_at?: string | null;
  health_status?: "UNKNOWN" | "OK" | "WAITING_FOR_QR" | "DISCONNECTED" | "GATEWAY_UNREACHABLE" | "PROVIDER_ERROR" | null;
  health_checked_at?: string | null;
  health_error_code?: string | null;
  health_consecutive_failures?: number | null;
  qr_code?: string | null;
  qr_expires_at?: string | null;
};

export type WhatsAppSettingsStatus = {
  connections: WhatsAppConnection[];
  managerNotification: {
    phoneE164: string | null;
    matchesQrPhone: boolean;
  };
  automation: {
    booking_client_enabled: boolean;
    booking_staff_enabled: boolean;
    reminder_morning_enabled: boolean;
    reminder_t180_enabled: boolean;
    reminder_t45_enabled: boolean;
    custom_messages: WhatsAppCustomMessage[];
  };
};

type WhatsAppCustomMessageKey = "AFTER_SERVICE_14D" | "AFTER_SERVICE_28D" | "AFTER_SERVICE_40D" | "BIRTHDAY" | "SPECIAL_DATES" | "MARKETING_CAMPAIGNS";

type WhatsAppCustomMessage = {
  key: WhatsAppCustomMessageKey;
  enabled: boolean;
  body: string;
};

const defaultAutomationRules: WhatsAppSettingsStatus["automation"] = {
  booking_client_enabled: true,
  booking_staff_enabled: true,
  reminder_morning_enabled: true,
  reminder_t180_enabled: false,
  reminder_t45_enabled: true,
  custom_messages: [],
};

const automaticMessages: Array<{ key: Exclude<keyof WhatsAppSettingsStatus["automation"], "custom_messages">; title: string; description: string }> = [
  { key: "booking_client_enabled", title: "Confirmação de agendamento para o cliente", description: "Vai para o cliente após o agendamento confirmado. Vale para novos agendamentos feitos depois da ativação." },
  { key: "booking_staff_enabled", title: "Confirmação de agendamento para o barbeiro", description: "Vai para o barbeiro após o cliente agendar. Vale para novos agendamentos feitos depois da ativação." },
  { key: "reminder_morning_enabled", title: "Confirmação de presença às 8h", description: "Vai ao cliente às 08:00 no dia do atendimento. Ao confirmar, o barbeiro também é avisado." },
  { key: "reminder_t180_enabled", title: "Confirmação de presença 3 horas antes", description: "Vai ao cliente 180 minutos antes do atendimento. Ao confirmar, o barbeiro também é avisado." },
  { key: "reminder_t45_enabled", title: "Confirmação de presença 45 minutos antes", description: "Vai ao cliente 45 minutos antes do atendimento. Ao confirmar, o barbeiro também é avisado." },
];

const customMessageGroups: Array<{ title: string; messages: Array<{ key: WhatsAppCustomMessageKey; title: string }> }> = [
  { title: "Mensagens após o serviço", messages: [
    { key: "AFTER_SERVICE_14D", title: "14 dias após o serviço" },
    { key: "AFTER_SERVICE_28D", title: "28 dias após o serviço" },
    { key: "AFTER_SERVICE_40D", title: "40 dias após o serviço" },
  ] },
  { title: "Mensagens de Felicitações", messages: [
    { key: "BIRTHDAY", title: "Aniversário" },
    { key: "SPECIAL_DATES", title: "Datas Especiais" },
  ] },
  { title: "Mensagens de Marketing", messages: [{ key: "MARKETING_CAMPAIGNS", title: "Promoções e campanhas" }] },
];

function customMessageDefaults(messages: WhatsAppCustomMessage[]): WhatsAppCustomMessage[] {
  const byKey = new Map(messages.map((message) => [message.key, message]));
  return customMessageGroups.flatMap((group) => group.messages.map(({ key }) => byKey.get(key) ?? { key, enabled: false, body: "" }));
}

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
  if (connection.health_error_code === "PROVIDER_CONNECTING" || connection.last_error_code === "PROVIDER_CONNECTING") return "VERIFICANDO CONEXÃO";
  if (connection.health_status === "GATEWAY_UNREACHABLE") return "GATEWAY INDISPONÍVEL";
  if (connection.health_status === "PROVIDER_ERROR") return "ERRO EVOLUTION";
  if (connection.health_status === "DISCONNECTED") return "DESCONECTADO";
  if (connection.status === "CONNECTED" && connection.health_status === "UNKNOWN") return "VERIFICAÇÃO PENDENTE";
  if (connection.status === "CONNECTED") return connection.is_active ? "ATIVO" : "CONECTADO";
  if (connection.status === "WAITING_FOR_QR") return "AGUARDANDO QR";
  if (connection.status === "REAUTH_REQUIRED") return "REAUTENTICAÇÃO";
  return connection.status;
}

function diagnostic(connection: WhatsAppConnection | undefined) {
  if (!connection) return {
    title: "WhatsApp QR ainda não configurado",
    body: "Clique em Gerar QR. No celular: WhatsApp Business → Aparelhos conectados → Conectar dispositivo.",
    warning: true,
  };
  if (connection.provider === "QR_WEB" && connection.health_status === "GATEWAY_UNREACHABLE") return {
    title: "Gateway Evolution indisponível",
    body: "A VPS não respondeu. Clique em Atualizar status. Se persistir, acione suporte para verificar a VPS; não tente reenviar mensagens manualmente.",
    warning: true,
  };
  if (connection.health_error_code === "PROVIDER_CONNECTING" || connection.last_error_code === "PROVIDER_CONNECTING") return {
    title: "Confirmando conexão com o WhatsApp",
    body: "O QR Code foi lido. A Evolution está finalizando a conexão; aguarde alguns segundos. Esta tela será atualizada automaticamente quando o estado ficar ativo.",
    warning: false,
  };
  if (connection.health_status === "DISCONNECTED" || connection.status === "REAUTH_REQUIRED" || connection.status === "DISCONNECTED") return {
    title: "WhatsApp desconectado",
    body: "Problema: a sessão do WhatsApp não está conectada. Ação: remova a sessão antiga no WhatsApp Business → Aparelhos conectados; depois gere um novo QR e leia o código.",
    warning: true,
  };
  if (connection.status === "CONNECTED" && connection.health_status === "UNKNOWN") return {
    title: "Conexão aguardando verificação",
    body: "O gateway ainda não respondeu ao verificador. Clique em Atualizar status; se persistir, remova a sessão no celular e gere novo QR.",
    warning: true,
  };
  if (connection.status === "CONNECTED" && connection.health_status !== "PROVIDER_ERROR") return {
    title: "WhatsApp conectado",
    body: "Conexão verificada. Novos agendamentos com consentimento podem gerar confirmação e lembretes conforme regras ativas.",
    warning: false,
  };
  if (connection.status === "WAITING_FOR_QR") return {
    title: "Aguardando leitura do QR Code",
    body: "Abra WhatsApp Business → Aparelhos conectados → Conectar dispositivo e leia o QR. Se o código não aparecer, clique em Gerar QR novamente.",
    warning: true,
  };
  return {
    title: "Evolution retornou erro",
    body: "Atualize o status. Se continuar, remova a sessão no celular, desconecte a integração e gere novo QR. Código técnico: " + (connection.health_error_code ?? connection.last_error_code ?? "PROVIDER_ERROR"),
    warning: true,
  };
}

export function WhatsAppSettings({ organizationId, organizationName, status, schemaReady = true }: Props) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busyProvider, setBusyProvider] = useState<"META_CLOUD" | "QR_WEB" | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [qrCodeOverride, setQrCodeOverride] = useState<string | null | undefined>(undefined);
  const initialAutomation = { ...defaultAutomationRules, ...status.automation };
  const [automationRules, setAutomationRules] = useState(initialAutomation);
  const [customMessages, setCustomMessages] = useState(() => customMessageDefaults(initialAutomation.custom_messages));
  const managerNotification = status.managerNotification ?? { phoneE164: null, matchesQrPhone: false };
  const [managerNotificationPhone, setManagerNotificationPhone] = useState(managerNotification.phoneE164 ?? "");
  const [managerNotificationMatchesQr, setManagerNotificationMatchesQr] = useState(managerNotification.matchesQrPhone);
  const [managerNotificationFeedback, setManagerNotificationFeedback] = useState<{ tone: "error" | "success"; message: string } | null>(
    managerNotification.phoneE164 ? { tone: "success", message: `Número salvo: ${managerNotification.phoneE164}` } : null,
  );
  const [savingManagerNotification, setSavingManagerNotification] = useState(false);
  const refreshInFlight = useRef(false);

  const connectionByProvider = new Map(status.connections.map((connection) => [connection.provider, connection]));
  const qrConnection = connectionByProvider.get("QR_WEB");
  const qrDiagnostic = diagnostic(qrConnection);
  const activeConnectionHealthy = status.connections.some((connection) =>
    connection.is_active && connection.status === "CONNECTED" &&
    (!connection.health_status || connection.health_status === "OK")
  );

  const visibleQrCode = qrCodeOverride === undefined ? qrConnection?.qr_code ?? null : qrCodeOverride;

  async function startConnection(provider: "META_CLOUD" | "QR_WEB") {
    setBusyProvider(provider);
    try {
      const result = await connectedClient().functions.invoke(
        provider === "META_CLOUD" ? "whatsapp-embedded-signup-start" : "whatsapp-qr-start",
        { body: { organizationId, returnPath: "/gestor/configuracoes/whatsapp" } },
      );
      if (result.error) throw result.error;
      const data = result.data as { authorizationUrl?: string; qrCode?: string | null; qrAvailable?: boolean } | null;
      if (provider === "META_CLOUD" && data?.authorizationUrl) {
        window.open(data.authorizationUrl, "los-barberos-whatsapp", "noopener,noreferrer");
        setMessage("A janela segura da Meta foi aberta para concluir a conexão.");
      } else {
        setQrCodeOverride(data?.qrCode ?? null);
        setMessage(data?.qrCode
          ? "QR pronto. No WhatsApp Business: Aparelhos conectados → Conectar dispositivo → leia o código."
          : "Evolution aceitou a solicitação, mas ainda não entregou o QR. Aguarde alguns segundos e clique em Atualizar status. Se persistir, remova a sessão no celular e gere novo QR.");
        router.refresh();
      }
    } catch (error) {
      setMessage("Falha ao comunicar com o gateway Evolution. Confirme a VPS; remova a sessão no celular e gere novo QR. " + (error instanceof Error ? error.message : "Tente novamente."));
    } finally {
      setBusyProvider(null);
    }
  }

  async function saveAutomation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("save_whatsapp_v2_automation_controls", {
        p_organization_id: organizationId,
        p_rules: {
          booking_client_enabled: automationRules.booking_client_enabled,
          booking_staff_enabled: automationRules.booking_staff_enabled,
          reminder_morning_enabled: automationRules.reminder_morning_enabled,
          reminder_t180_enabled: automationRules.reminder_t180_enabled,
          reminder_t45_enabled: automationRules.reminder_t45_enabled,
        },
        p_custom_messages: customMessages,
      }));
    }, "Automações atualizadas.");
    if (saved) setMessage("Automações atualizadas. Regras ativas valem somente para novos agendamentos confirmados; mensagens personalizadas continuam salvas sem envio nesta etapa.");
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
    }, "Integração desconectada no sistema.");
    if (saved) {
      setMessage("Integração desconectada no sistema. Agora remova manualmente a sessão Los Barberos no WhatsApp Business do celular: Aparelhos conectados → remova o dispositivo. Depois clique em Gerar QR e leia o novo código.");
      router.refresh();
    }
  }

  async function saveManagerNotification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedPhone = managerNotificationPhone.trim() ? normalizePhoneE164(managerNotificationPhone) : null;
    if (!normalizedPhone) {
      setManagerNotificationFeedback({ tone: "error", message: "Informe um WhatsApp válido para receber avisos do gestor." });
      return;
    }
    setSavingManagerNotification(true);
    setManagerNotificationFeedback(null);
    try {
      const result = await connectedClient().rpc("save_whatsapp_v2_manager_notification_phone", {
        p_organization_id: organizationId,
        p_phone: normalizedPhone,
      });
      await assertResult(result);
      const value = result.data as { phone_e164?: string | null; matches_qr_phone?: boolean } | null;
      if (!value?.phone_e164) throw new Error("O servidor não confirmou o número salvo. Tente novamente.");
      setManagerNotificationPhone(value.phone_e164);
      setManagerNotificationMatchesQr(value?.matches_qr_phone === true);
      setManagerNotificationFeedback({ tone: "success", message: `Número salvo: ${value.phone_e164}` });
      router.refresh();
    } catch (error) {
      setManagerNotificationFeedback({ tone: "error", message: `Não foi possível salvar o número. ${humanizeError(error)}` });
    } finally {
      setSavingManagerNotification(false);
    }
  }

  const refreshStatus = useCallback(async (automatic = false) => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setCheckingStatus(true);
    try {
      const result = await connectedClient().functions.invoke("whatsapp-qr-status", {
        body: { organizationId },
      });
      if (result.error) throw result.error;
      const state = (result.data as { state?: string } | null)?.state;
      const normalizedState = state?.trim().toLowerCase();
      setMessage(normalizedState === "open"
        ? "Evolution confirmou WhatsApp conectado. A tela será atualizada automaticamente."
        : normalizedState === "connecting"
          ? "QR lido. A Evolution está confirmando a conexão automaticamente."
          : `Evolution informou estado: ${state ?? "desconhecido"}.`);
    } catch {
      if (!automatic) setMessage("Não foi possível consultar a Evolution agora. Verifique a VPS e tente novamente.");
    } finally {
      refreshInFlight.current = false;
      setCheckingStatus(false);
      setQrCodeOverride(undefined);
      router.refresh();
    }
  }, [organizationId, router]);

  useEffect(() => {
    if (qrConnection?.status !== "WAITING_FOR_QR" || !visibleQrCode) return;
    let active = true;
    const poll = () => {
      if (active) void refreshStatus(true);
    };
    poll();
    const timer = window.setInterval(poll, 10_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [qrConnection?.status, visibleQrCode, refreshStatus]);

  return <div className={`${styles.stack} settings-page`}>
    <PageHeader title="WhatsApp" description={`Conecte o WhatsApp da ${organizationName} e automatize avisos transacionais.`} />
    <ActionMessage message={message} />
    {!schemaReady && <p className={styles.message}>A estrutura conectada desta integração ainda aguarda a migration remota. A tela está pronta, mas salvar e conectar ficará disponível após a aplicação autorizada.</p>}

    <section className={styles.whatsappHero} aria-labelledby="whatsapp-title">
      <div>
        <span className={styles.whatsappEyebrow}>INTEGRAÇÃO POR BARBEARIA</span>
        <h1 id="whatsapp-title">WhatsApp da sua operação</h1>
        <p>Conecte seu Whatsapp Business, envie confirmações e lembretes de forma automática com consentimento do cliente.</p>
      </div>
      <StatusChip active={activeConnectionHealthy} label={checkingStatus ? "VERIFICANDO…" : activeConnectionHealthy ? "CONECTADO" : "AÇÃO NECESSÁRIA"} />
    </section>

    <Panel title="Escolha como conectar">
      <div className={styles.providerGrid}>
        {(["QR_WEB"] as Array<"META_CLOUD" | "QR_WEB">).map((provider) => {
          const connection = connectionByProvider.get(provider);
          const isMeta = provider === "META_CLOUD";
          return <article className={`${styles.providerCard} ${connection?.is_active ? styles.providerCardActive : ""}`} key={provider}>
            <div className={styles.providerCardTop}>
              <div className={styles.providerIcon}>{isMeta ? "M" : "QR"}</div>
              <StatusChip active={connection?.status === "CONNECTED" && (!connection.health_status || connection.health_status === "OK")} label={checkingStatus && connection?.provider === "QR_WEB" ? "VERIFICANDO…" : connectionLabel(connection)} />
            </div>
            <h3>{provider === "QR_WEB" ? "Whatsapp Web API" : providerLabels[provider]}</h3>
            <p>{isMeta ? "Canal oficial da Meta, com Embedded Signup e templates aprovados." : "Gateway Evolution API em VPS dedicado. Canal não oficial, sujeito a restrições do WhatsApp."}</p>
            {connection?.phone_number_id && <small>Phone Number ID: {connection.phone_number_id}</small>}
            {connection?.gateway_instance_id && <small>Instância: {connection.gateway_instance_id}</small>}
            <div className={styles.rowActions}>
              <button className={styles.button} type="button" onClick={() => void startConnection(provider)} disabled={busyProvider !== null || !schemaReady}>
                {busyProvider === provider ? "Iniciando…" : connection?.status === "CONNECTED" ? "Reconectar" : isMeta ? "Conectar Meta" : "Gerar QR"}
              </button>
              {connection && connection.provider === "QR_WEB" && connection.status !== "PENDING" && <>
                {connection.status === "CONNECTED" && !connection.is_active && <button className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} type="button" onClick={() => void setActive(connection)} disabled={!schemaReady}>Ativar</button>}
                <button className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} type="button" onClick={() => void disconnect(connection)} disabled={!schemaReady}>Desconectar</button>
                <button className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} type="button" onClick={() => void refreshStatus()} disabled={!schemaReady || checkingStatus}>{checkingStatus ? "Verificando…" : "Atualizar status"}</button>
              </>}
              {connection?.provider === "META_CLOUD" && connection?.status === "CONNECTED" && <>
                {!connection.is_active && <button className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} type="button" onClick={() => void setActive(connection)} disabled={!schemaReady}>Ativar</button>}
                <button className={`${styles.button} ${styles.buttonSoft} ${styles.buttonSmall}`} type="button" onClick={() => void disconnect(connection)} disabled={!schemaReady}>Desconectar</button>
              </>}
            </div>
            {connection?.provider === "QR_WEB" && <small className={styles.muted}>Desconectar aqui atualiza o sistema. Remova também manualmente a sessão em WhatsApp Business → Aparelhos conectados.</small>}
          </article>;
        })}
      </div>
      <div className={`${styles.message} ${qrDiagnostic.warning ? styles.warning : ""}`} role="status">
        <strong>{qrDiagnostic.title}</strong><br />{qrDiagnostic.body}
        {checkingStatus && <span className={styles.statusProgress}><span className={styles.spinner} aria-hidden="true" /> Verificando conexão automaticamente…</span>}
        {qrConnection?.health_checked_at && <><br /><small>Última verificação: {new Date(qrConnection.health_checked_at).toLocaleString("pt-BR")}</small></>}
      </div>
      {visibleQrCode && <div className={styles.qrConnection}>
        <div><strong>Escaneie com o WhatsApp Business</strong><p>Abra Aparelhos conectados no celular do gestor e leia este código.</p></div>
        <img src={visibleQrCode.startsWith("data:") ? visibleQrCode : `data:image/png;base64,${visibleQrCode}`} alt="QR Code temporário para conectar o WhatsApp" />
      </div>}
    </Panel>

    <Panel title="Avisos do gestor" description="Receba solicitações de atendimento do cliente em um WhatsApp separado da conta conectada ao QR.">
      <form onSubmit={saveManagerNotification} className={styles.stack}>
        <Field label="WhatsApp para avisos do gestor">
          <input
            aria-label="WhatsApp para avisos do gestor"
            inputMode="tel"
            required
            placeholder="47999999999 ou +5547999999999"
            value={managerNotificationPhone}
            disabled={!schemaReady}
            onChange={(event) => setManagerNotificationPhone(event.target.value)}
            onBlur={(event) => {
              const normalized = normalizePhoneE164(event.currentTarget.value);
              if (normalized) setManagerNotificationPhone(normalized);
            }}
          />
        </Field>
        <small className={styles.muted}>Usado somente quando o cliente escolher 3 — Falar com atendente ou após três respostas inválidas.</small>
        {managerNotificationFeedback && <p className={`${styles.message} ${managerNotificationFeedback.tone === "error" ? styles.error : ""}`} role="status">{managerNotificationFeedback.message}</p>}
        {managerNotificationMatchesQr && <p className={`${styles.message} ${styles.warning}`}>Número igual ao da API, poderá ter problemas de envio/recebimento de mensagens no futuro.</p>}
        <div className={styles.rowActions}><button className={styles.button} type="submit" disabled={!schemaReady || savingManagerNotification}>{savingManagerNotification ? "Salvando…" : "Salvar número de avisos"}</button></div>
      </form>
    </Panel>

    <Panel title="Mensagens automáticas" description="Escolha quais avisos transacionais serão enviados automaticamente pelo WhatsApp.">
      <form onSubmit={saveAutomation} className={styles.stack}>
        <div className={styles.automationList}>
          {automaticMessages.map((automation) => <div className={styles.automationRow} key={automation.key}>
            <div><strong>{automation.title}</strong><small>{automation.description}</small></div>
            <label className={styles.automationSwitch}>
              <span className="sr-only">{automation.title}</span>
              <input type="checkbox" checked={automationRules[automation.key]} disabled={!schemaReady} onChange={(event) => setAutomationRules((current) => ({ ...current, [automation.key]: event.target.checked }))} />
            </label>
          </div>)}
        </div>
        <div className={styles.rowActions}><button className={styles.button} type="submit" disabled={!schemaReady}>Salvar automações</button></div>
      </form>
    </Panel>

    <Panel title="Mensagens Personalizadas" description="Salve textos e ativações para as próximas automações. Ainda não há envio automático destas mensagens.">
      <form onSubmit={saveAutomation} className={styles.stack}>
        {customMessageGroups.map((group) => <section className={styles.customMessageGroup} key={group.title} aria-labelledby={`custom-${group.title}`}>
          <h3 id={`custom-${group.title}`}>{group.title}</h3>
          <div className={styles.automationList}>
            {group.messages.map((definition) => {
              const messageDefinition = customMessages.find((message) => message.key === definition.key)!;
              return <article className={styles.customMessageRow} key={definition.key}>
                <div className={styles.automationRow}>
                  <div><strong>{definition.title}</strong><small>Configuração salva para uso futuro; não dispara mensagens nesta etapa.</small></div>
                  <label className={styles.automationSwitch}>
                    <span className="sr-only">Ativar {definition.title}</span>
                    <input type="checkbox" checked={messageDefinition.enabled} disabled={!schemaReady} onChange={(event) => setCustomMessages((current) => current.map((item) => item.key === definition.key ? { ...item, enabled: event.target.checked } : item))} />
                  </label>
                </div>
                <Field label={`Texto de ${definition.title}`} wide>
                  <textarea aria-label={`Texto de ${definition.title}`} value={messageDefinition.body} disabled={!schemaReady} onChange={(event) => setCustomMessages((current) => current.map((item) => item.key === definition.key ? { ...item, body: event.target.value } : item))} maxLength={4096} />
                </Field>
                <small className={styles.muted}>Variáveis para a futura integração: &#123;cliente&#125;, &#123;barbeiro&#125;, &#123;servico&#125; e &#123;horario&#125;. Não inclua tokens ou dados sensíveis.</small>
              </article>;
            })}
          </div>
        </section>)}
        <div className={styles.rowActions}><button className={styles.button} type="submit" disabled={!schemaReady}>Salvar automações</button></div>
      </form>
    </Panel>
  </div>;
}
