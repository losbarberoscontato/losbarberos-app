"use client";

import { WhatsAppCampaignDialog } from "./whatsapp-campaign-dialog";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { PageHeader } from "@/components/ui";
import { normalizePhoneE164 } from "@/lib/phone";
import { ActionMessage, Field, Panel, StatusChip } from "./shared";
import { assertResult, connectedClient, runMutation } from "./mutation-utils";
import { humanizeError } from "./format";
import styles from "./connected-manager.module.css";
import type { ProductKey } from "@/lib/product-context";
import { insertTemplateVariable, normalizeReminderSelection, reminderRuleKeys, selectExclusiveReminder, type ReminderRuleKey } from "./whatsapp-message-editing";

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
  runtime?: { ready: boolean; pending: number; failed: number; campaigns?: Array<{ id: string; message_key: string; scheduled_for: string; status: string }> };
  connections: WhatsAppConnection[];
  managerNotification: {
    phoneE164: string | null;
    matchesQrPhone: boolean;
  };
  automation: {
    booking_client_enabled: boolean;
    booking_staff_enabled: boolean;
    reminder_t24_enabled: boolean;
    reminder_morning_enabled: boolean;
    reminder_t180_enabled: boolean;
    reminder_t45_enabled: boolean;
    message_templates?: Partial<Record<WhatsAppFixedMessageKey, string>>;
    custom_messages: WhatsAppCustomMessage[];
  };
};

type WhatsAppFixedMessageKey =
  | "BOOKING_CREATED_CLIENT" | "BOOKING_CREATED_STAFF"
  | "REMINDER_T24_CLIENT" | "REMINDER_MORNING_CLIENT" | "REMINDER_T180_CLIENT" | "REMINDER_T45_CLIENT"
  | "CONFIRMATION_ACK_CLIENT" | "CANCELLATION_ACK_CLIENT"
  | "APPOINTMENT_CONFIRMED_STAFF" | "APPOINTMENT_CANCELED_STAFF"
  | "INVALID_REPLY_PROMPT" | "ATTENDANT_REQUEST_MANAGER"
  | "MANUAL_CONFIRMATION_CLIENT" | "MANUAL_CONFIRMATION_STAFF" | "RESERVATION_CHOICE";

type AutomationToggleKey = "booking_client_enabled" | "booking_staff_enabled" | ReminderRuleKey;

type FixedMessageDefinition = {
  key: WhatsAppFixedMessageKey;
  title: string;
  description: string;
  toggle?: AutomationToggleKey;
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
  reminder_t24_enabled: false,
  reminder_morning_enabled: false,
  reminder_t180_enabled: false,
  reminder_t45_enabled: true,
  custom_messages: [],
};

const bookingAndReminderMessages: FixedMessageDefinition[] = [
  { key: "BOOKING_CREATED_CLIENT", toggle: "booking_client_enabled", title: "Confirmação de agendamento para o cliente", description: "Enviada quando o cliente confirma um novo agendamento." },
  { key: "BOOKING_CREATED_STAFF", toggle: "booking_staff_enabled", title: "Confirmação de agendamento para o profissional", description: "Enviada ao profissional após um novo agendamento." },
  { key: "REMINDER_T24_CLIENT", toggle: "reminder_t24_enabled", title: "Confirmação de presença 24 horas antes", description: "Enviada ao cliente 24 horas antes do atendimento." },
  { key: "REMINDER_MORNING_CLIENT", toggle: "reminder_morning_enabled", title: "Confirmação de presença às 8h", description: "Enviada ao cliente às 08:00 no dia do atendimento." },
  { key: "REMINDER_T180_CLIENT", toggle: "reminder_t180_enabled", title: "Confirmação de presença 3 horas antes", description: "Enviada ao cliente 180 minutos antes do atendimento." },
  { key: "REMINDER_T45_CLIENT", toggle: "reminder_t45_enabled", title: "Confirmação de presença 45 minutos antes", description: "Enviada ao cliente 45 minutos antes do atendimento." },
];

const responseMessages: FixedMessageDefinition[] = [
  { key: "CONFIRMATION_ACK_CLIENT", title: "Cliente confirmou presença", description: "Retorno enviado após a resposta 1 — Confirmar." },
  { key: "CANCELLATION_ACK_CLIENT", title: "Cliente cancelou", description: "Retorno enviado após a resposta 2 — Cancelar." },
  { key: "APPOINTMENT_CONFIRMED_STAFF", title: "Aviso ao profissional: presença confirmada", description: "Enviado ao profissional após o cliente confirmar." },
  { key: "APPOINTMENT_CANCELED_STAFF", title: "Aviso ao profissional: cancelamento", description: "Enviado ao profissional após o cliente cancelar." },
  { key: "ATTENDANT_REQUEST_MANAGER", title: "Pedido para falar com atendente", description: "Enviado ao número de avisos do gestor após a resposta 3." },
  { key: "INVALID_REPLY_PROMPT", title: "Resposta inválida", description: "Enviada quando o cliente responde com uma opção diferente de 1, 2 ou 3." },
  { key: "MANUAL_CONFIRMATION_CLIENT", title: "Confirmação manual para o cliente", description: "Enviada quando o gestor confirma presença manualmente." },
  { key: "MANUAL_CONFIRMATION_STAFF", title: "Confirmação manual para o profissional", description: "Enviada ao profissional após confirmação manual." },
  { key: "RESERVATION_CHOICE", title: "Escolha entre vários agendamentos", description: "Enviada quando o cliente tem mais de um pedido de confirmação em aberto." },
];

const defaultMessageTemplates: Record<WhatsAppFixedMessageKey, string> = {
  BOOKING_CREATED_CLIENT: "{cliente}, seu agendamento foi confirmado para {horario}.",
  BOOKING_CREATED_STAFF: "Novo agendamento: {cliente}, {horario}.",
  REMINDER_T24_CLIENT: "Lembrete: seu atendimento está marcado para {horario} (daqui a 24 horas).\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente",
  REMINDER_MORNING_CLIENT: "Lembrete: seu atendimento é {horario}.\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente",
  REMINDER_T180_CLIENT: "Lembrete: seu atendimento está marcado para {horario}.\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente",
  REMINDER_T45_CLIENT: "Lembrete: seu atendimento está marcado para {horario}.\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente",
  CONFIRMATION_ACK_CLIENT: "Presença confirmada. Até {horario}.",
  CANCELLATION_ACK_CLIENT: "Cancelamento confirmado. Se precisar, fale com o estabelecimento para novo horário.",
  APPOINTMENT_CONFIRMED_STAFF: "{cliente} confirmou presença pelo WhatsApp para {horario}.",
  APPOINTMENT_CANCELED_STAFF: "{cliente} cancelou pelo WhatsApp.",
  INVALID_REPLY_PROMPT: "Não entendi sua resposta.\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente",
  ATTENDANT_REQUEST_MANAGER: "Cliente deseja falar com atendente.\n\nCliente: {cliente}\nWhatsApp: {telefone}\nData e hora: {horario}\nProfissional: {barbeiro}\nServiço: {servico}",
  MANUAL_CONFIRMATION_CLIENT: "{cliente}, seu agendamento foi confirmado pelo estabelecimento para {horario}.",
  MANUAL_CONFIRMATION_STAFF: "Agendamento confirmado manualmente: {cliente}, {horario}.",
  RESERVATION_CHOICE: "Encontrei mais de um agendamento. Responda com o número correspondente:\n\n{reservas}",
};

const messageVariables = ["{cliente}", "{barbeiro}", "{horario}", "{servico}", "{telefone}", "{reservas}"] as const;

function messageDefinitionTitle(key: WhatsAppFixedMessageKey) {
  return [...bookingAndReminderMessages, ...responseMessages].find((message) => message.key === key)?.title ?? key;
}

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
  productKey?: ProductKey;
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

export function WhatsAppSettings({ organizationId, organizationName, status, schemaReady = true, productKey = "los-barberos" }: Props) {
  const isLeGras = productKey === "le-gras";
  const isMusicPro = productKey === "music-pro";
  const isProStetic = productKey === "pro-stetic";
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busyProvider, setBusyProvider] = useState<"META_CLOUD" | "QR_WEB" | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [qrCodeOverride, setQrCodeOverride] = useState<string | null | undefined>(undefined);
  const initialAutomation = { ...defaultAutomationRules, ...status.automation };
  const [automationRules, setAutomationRules] = useState(() => normalizeReminderSelection(initialAutomation));
  const [messageTemplates, setMessageTemplates] = useState<Record<WhatsAppFixedMessageKey, string>>(() => ({ ...defaultMessageTemplates, ...status.automation.message_templates }));
  const [editingTemplate, setEditingTemplate] = useState<WhatsAppFixedMessageKey | null>(null);
  const templateEditors = useRef<Partial<Record<WhatsAppFixedMessageKey, HTMLTextAreaElement | null>>>({});
  const pendingTemplateCursor = useRef<{ key: WhatsAppFixedMessageKey; cursor: number } | null>(null);
  const [customMessages, setCustomMessages] = useState(() => customMessageDefaults(initialAutomation.custom_messages));
  const managerNotification = status.managerNotification ?? { phoneE164: null, matchesQrPhone: false };
  const [managerNotificationPhone, setManagerNotificationPhone] = useState(managerNotification.phoneE164 ?? "");
  const [managerNotificationMatchesQr, setManagerNotificationMatchesQr] = useState(managerNotification.matchesQrPhone);
  const [managerNotificationFeedback, setManagerNotificationFeedback] = useState<{ tone: "error" | "success"; message: string } | null>(
    managerNotification.phoneE164 ? { tone: "success", message: `Número salvo: ${managerNotification.phoneE164}` } : null,
  );
  const [savingManagerNotification, setSavingManagerNotification] = useState(false);
  const refreshInFlight = useRef(false);
  const [campaignKey, setCampaignKey] = useState<string | null>(null);
  const customReady = schemaReady && status.runtime?.ready === true;
  const updateCustom = (key: WhatsAppCustomMessageKey, patch: Partial<WhatsAppCustomMessage>) => setCustomMessages((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));

  useLayoutEffect(() => {
    const pending = pendingTemplateCursor.current;
    if (!pending) return;
    const editor = templateEditors.current[pending.key];
    if (editor) {
      editor.focus();
      editor.setSelectionRange(pending.cursor, pending.cursor);
    }
    pendingTemplateCursor.current = null;
  }, [messageTemplates]);

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

  async function persistAutomation() {
    return runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("save_whatsapp_v2_automation_controls", {
        p_organization_id: organizationId,
        p_rules: {
          booking_client_enabled: automationRules.booking_client_enabled,
          booking_staff_enabled: automationRules.booking_staff_enabled,
          reminder_t24_enabled: automationRules.reminder_t24_enabled,
          reminder_morning_enabled: automationRules.reminder_morning_enabled,
          reminder_t180_enabled: automationRules.reminder_t180_enabled,
          reminder_t45_enabled: automationRules.reminder_t45_enabled,
          message_templates: messageTemplates,
        },
        p_custom_messages: customMessages,
      }));
    }, "Automações atualizadas.");
  }

  async function saveAutomation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = await persistAutomation();
    if (saved) setMessage(customReady ? "Automações atualizadas. Mensagens personalizadas respeitarão consentimento, horário e limites de frequência." : "Automações atualizadas. Regras ativas valem somente para novos agendamentos confirmados; mensagens personalizadas continuam salvas sem envio nesta etapa.");
  }

  async function saveTemplate(key: WhatsAppFixedMessageKey) {
    if (!schemaReady) return;
    const saved = await persistAutomation();
    if (saved) {
      setEditingTemplate(null);
      setMessage(`Texto de ${messageDefinitionTitle(key)} salvo.`);
    }
  }

  function insertVariable(key: WhatsAppFixedMessageKey, variable: string) {
    const editor = templateEditors.current[key];
    if (!editor) return;
    const inserted = insertTemplateVariable(
      messageTemplates[key],
      editor.selectionStart ?? messageTemplates[key].length,
      editor.selectionEnd ?? messageTemplates[key].length,
      variable,
    );
    pendingTemplateCursor.current = { key, cursor: inserted.cursor };
    setMessageTemplates((current) => ({ ...current, [key]: inserted.value }));
  }

  function updateAutomation(key: AutomationToggleKey, enabled: boolean) {
    if (reminderRuleKeys.includes(key as ReminderRuleKey)) {
      setAutomationRules((current) => selectExclusiveReminder(current, key as ReminderRuleKey, enabled));
      return;
    }
    setAutomationRules((current) => ({ ...current, [key]: enabled }));
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

  function fixedMessageCard(definition: FixedMessageDefinition) {
    const title = isLeGras
      ? definition.title.replaceAll("profissional", "fotógrafo")
      : isMusicPro
        ? definition.title.replaceAll("agendamento", "aula").replaceAll("cliente", "aluno").replaceAll("profissional", "professor")
        : isProStetic
          ? definition.title.replaceAll("profissional", "especialista")
          : definition.title;
    const description = isMusicPro
      ? definition.description.replaceAll("agendamentos", "aulas").replaceAll("agendamento", "aula").replaceAll("cliente", "aluno").replaceAll("profissional", "professor").replaceAll("atendimento", "aula")
      : isProStetic
        ? definition.description.replaceAll("profissional", "especialista").replaceAll("atendimento", "serviço").replaceAll("agendamento", "serviço")
        : definition.description;
    const editing = editingTemplate === definition.key;
    return <article className={styles.whatsappTemplateCard} key={definition.key}>
      <div className={styles.whatsappTemplateHead}>
        <div><strong>{title}</strong><small>{description}</small></div>
        {definition.toggle
          ? <label className={styles.automationSwitch}>
              <span className="sr-only">Ativar {title}</span>
              <input type="checkbox" checked={automationRules[definition.toggle]} disabled={!schemaReady} onChange={(event) => updateAutomation(definition.toggle!, event.target.checked)} />
            </label>
          : <span className={styles.whatsappReplyBadge}>Enviada pelo fluxo</span>}
      </div>
      <Field label={`Texto: ${title}`} wide>
        <textarea
          ref={(node) => { templateEditors.current[definition.key] = node; }}
          aria-label={`Texto: ${title}`}
          value={messageTemplates[definition.key]}
          disabled={!schemaReady || !editing}
          maxLength={4096}
          onChange={(event) => setMessageTemplates((current) => ({ ...current, [definition.key]: event.target.value }))}
        />
      </Field>
      <div className={styles.whatsappTemplateVariables} aria-label={`Variáveis para ${title}`}>
        <span>Variáveis</span>
        {messageVariables.map((variable) => <button
          className={styles.buttonSoft}
          type="button"
          key={variable}
          aria-label={`Inserir ${variable} em ${title}`}
          disabled={!schemaReady || !editing}
          onClick={() => insertVariable(definition.key, variable)}
        >{variable}</button>)}
      </div>
      <div className={styles.rowActions}>
        {editing
          ? <button className={styles.button} type="button" disabled={!schemaReady || !messageTemplates[definition.key].trim()} onClick={() => void saveTemplate(definition.key)}>Salvar texto: {title}</button>
          : <button className={`${styles.button} ${styles.buttonSoft}`} type="button" disabled={!schemaReady} onClick={() => setEditingTemplate(definition.key)}>Editar texto: {title}</button>}
      </div>
    </article>;
  }

  return <div className={`${styles.stack} settings-page ${isMusicPro ? styles.musicProWhatsApp : ""}`}>
    <PageHeader title="WhatsApp" description={`Conecte o WhatsApp da ${organizationName} e automatize avisos transacionais.`} />
    <ActionMessage message={message} />
    {!schemaReady && <p className={styles.message}>A estrutura conectada desta integração ainda aguarda a migration remota. A tela está pronta, mas salvar e conectar ficará disponível após a aplicação autorizada.</p>}

    <section className={`${styles.whatsappHero} ${isLeGras ? styles.whatsappHeroLeGras : isProStetic ? styles.whatsappHeroProStetic : isMusicPro ? styles.whatsappHeroMusicPro : ""}`} aria-labelledby="whatsapp-title">
      <div>
        <span className={styles.whatsappEyebrow}>{isLeGras || isMusicPro || isProStetic ? "INTEGRAÇÃO WHATSAPP" : "INTEGRAÇÃO POR BARBEARIA"}</span>
        <h1 id="whatsapp-title">{isMusicPro ? "WhatsApp da sua escola" : isProStetic ? "WhatsApp do seu estúdio" : "WhatsApp da sua operação"}</h1>
        <p>{isMusicPro ? "Conecte seu WhatsApp Business e envie confirmações e lembretes de aulas com consentimento dos alunos." : isProStetic ? "Conecte seu WhatsApp Business e envie confirmações e lembretes de serviços com consentimento dos clientes." : "Conecte seu Whatsapp Business, envie confirmações e lembretes de forma automática com consentimento do cliente."}</p>
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

    <Panel title="Mensagens automáticas" description="Edite os textos e escolha os avisos enviados pelo WhatsApp.">
      <form onSubmit={saveAutomation} className={styles.stack}>
        <details className={styles.whatsappMessageGroup} open>
          <summary className={styles.whatsappMessageGroupSummary}><span className={styles.whatsappMessageChevron} aria-hidden="true">›</span><span><strong>Agendamentos e lembretes</strong><small>Ative confirmações e escolha um único horário de lembrete.</small></span></summary>
          <div className={styles.whatsappMessageGroupContent}>
            {bookingAndReminderMessages.map((definition) => fixedMessageCard(definition))}
            <div className={styles.rowActions}><button className={styles.button} type="submit" disabled={!schemaReady}>Salvar ativações</button></div>
          </div>
        </details>
        <details className={styles.whatsappMessageGroup}>
          <summary className={styles.whatsappMessageGroupSummary}><span className={styles.whatsappMessageChevron} aria-hidden="true">›</span><span><strong>Respostas e retornos</strong><small>Textos enviados depois que o cliente responde ou o gestor confirma.</small></span></summary>
          <div className={styles.whatsappMessageGroupContent}>
            {responseMessages.map((definition) => fixedMessageCard(definition))}
          </div>
        </details>
      </form>
    </Panel>

    <Panel
      title="Mensagens Personalizadas"
      titleAdornment={customReady ? undefined : <StatusChip active={false} tone="danger" label="FUNÇÃO EM BREVE" />}
      description={customReady ? "Pós-serviço, felicitações e campanhas. Até uma mensagem por dia e duas por semana para cada cliente." : "Estas automações ainda não estão disponíveis para configuração ou envio."}
    >
      <form onSubmit={saveAutomation} className={styles.stack}>
        {customMessageGroups.map((group, index) => <details className={styles.whatsappMessageGroup} key={group.title} open={index === 0}>
          <summary className={styles.whatsappMessageGroupSummary}><span className={styles.whatsappMessageChevron} aria-hidden="true">›</span><span><strong>{group.title}</strong></span></summary>
          <div className={styles.whatsappMessageGroupContent}>
            {group.messages.map((definition) => {
              const messageDefinition = customMessages.find((message) => message.key === definition.key)!;
              return <article className={styles.customMessageRow} key={definition.key}>
                <div className={styles.automationRow}>
                  <div><strong>{definition.title}</strong><small>{customReady ? "Exige preferência de marketing ativa." : "Disponível em uma próxima atualização."}</small></div>
                  <label className={styles.automationSwitch}>
                    <span className="sr-only">Ativar {definition.title}</span>
                    <input type="checkbox" checked={messageDefinition.enabled} disabled={!customReady} onChange={(event) => updateCustom(definition.key, { enabled: event.target.checked })} />
                  </label>
                </div>
                <Field label={`Texto de ${definition.title}`} wide>
                  <textarea aria-label={`Texto de ${definition.title}`} value={messageDefinition.body} disabled={!customReady} maxLength={4096} onChange={(event) => updateCustom(definition.key, { body: event.target.value })} />
                </Field>
                <small className={styles.muted}>{customReady ? "Use {cliente} para incluir o nome. Salve antes de agendar." : "Variáveis e personalização serão liberadas junto da função."}</small>
                {customReady && ["SPECIAL_DATES", "MARKETING_CAMPAIGNS"].includes(definition.key) && <button type="button" className={styles.button} disabled={!messageDefinition.enabled || !messageDefinition.body.trim()} onClick={() => setCampaignKey(definition.key)}>Agendar {definition.title}</button>}
              </article>;
            })}
          </div>
        </details>)}
        <div className={styles.rowActions}><button className={styles.button} type="submit" disabled={!customReady}>Salvar automações</button></div>
      </form>
    </Panel>
    {!!status.runtime?.campaigns?.length && <Panel title="Mensagens agendadas" description="Cancelar interrompe os envios que ainda não começaram.">
      {status.runtime.campaigns.map((campaign) => <div key={campaign.id} className={styles.automationRow}>
        <div><strong>{campaign.message_key === "SPECIAL_DATES" ? "Data especial" : "Campanha"}</strong><small>{new Date(campaign.scheduled_for).toLocaleString("pt-BR")} · {campaign.status === "CANCELED" ? "Cancelada" : campaign.status === "ENQUEUED" ? "Processada" : "Agendada"}</small></div>
        {campaign.status === "SCHEDULED" && <button type="button" className={styles.button} onClick={async () => {
          const saved = await runMutation(setMessage, async () => { await assertResult(await connectedClient().rpc("cancel_whatsapp_campaign", { p_organization_id: organizationId, p_id: campaign.id })); }, "Campanha cancelada.");
          if (saved) router.refresh();
        }}>Cancelar campanha</button>}
      </div>)}
    </Panel>}
    {status.runtime && <p role="status">Mensagens pendentes: {status.runtime.pending}. Falhas que precisam de revisão: {status.runtime.failed}.</p>}
    {campaignKey && <WhatsAppCampaignDialog key={`${organizationId}:${campaignKey}`} organizationId={organizationId} messageKey={campaignKey} body={customMessages.find((m) => m.key === campaignKey)?.body ?? ""} onClose={() => { setCampaignKey(null); router.refresh(); }} />}
  </div>;
}
