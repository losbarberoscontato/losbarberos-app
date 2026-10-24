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
import { getWhatsAppProductCopy, localizeWhatsAppCopy, resolveWhatsAppProductTemplates, type WhatsAppFixedMessageKey } from "./whatsapp-product-copy";
import { confirmationReplyMessageKeys, editableTemplateHeader, fixedConfirmationReplyPrompt, insertTemplateVariable, isConfirmationReplyMessageKey, normalizeReminderSelection, reminderRuleKeys, selectExclusiveReminder, withFixedConfirmationReply, type ReminderRuleKey, type ReminderSelection } from "./whatsapp-message-editing";

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

const contractMessages: FixedMessageDefinition[] = [
  { key: "PROJECT_CONTRACT_CREATED_CLIENT", title: "Aviso de criação de contratos de projetos", description: "Enviada ao cliente quando o gestor cria um novo contrato de projeto." },
  { key: "SUBSCRIPTION_CREATED_CLIENT", title: "Aviso de criação de assinaturas", description: "Enviada ao cliente quando o gestor cria uma nova assinatura." },
];

const messageVariables = ["{cliente}", "{profissional}", "{horario}", "{servico}", "{telefone}", "{reservas}", "{link_app_cliente}", "{email_cliente}"] as const;

function normalizeConfirmationTemplates(templates: Record<WhatsAppFixedMessageKey, string>) {
  const normalized = { ...templates };
  for (const key of confirmationReplyMessageKeys) {
    normalized[key] = withFixedConfirmationReply(normalized[key]);
  }
  return normalized;
}

function reminderSelectionFrom(rules: ReminderSelection): ReminderSelection {
  return Object.fromEntries(reminderRuleKeys.map((key) => [key, rules[key]])) as ReminderSelection;
}

function selectedReminder(selection: ReminderSelection): ReminderRuleKey | null {
  return reminderRuleKeys.find((key) => selection[key]) ?? null;
}

function reminderLabel(key: ReminderRuleKey | null) {
  if (key === "reminder_t24_enabled") return "24 horas antes";
  if (key === "reminder_morning_enabled") return "às 08h do dia";
  if (key === "reminder_t180_enabled") return "3 horas antes";
  if (key === "reminder_t45_enabled") return "45 minutos antes";
  return null;
}

function messageDefinitionTitle(key: WhatsAppFixedMessageKey, productKey: ProductKey) {
  const title = [...bookingAndReminderMessages, ...responseMessages, ...contractMessages].find((message) => message.key === key)?.title ?? key;
  return localizeWhatsAppCopy(title, productKey);
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
  const productCopy = getWhatsAppProductCopy(productKey);
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busyProvider, setBusyProvider] = useState<"META_CLOUD" | "QR_WEB" | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [qrCodeOverride, setQrCodeOverride] = useState<string | null | undefined>(undefined);
  const initialAutomation = { ...defaultAutomationRules, ...status.automation };
  const [automationRules, setAutomationRules] = useState(() => normalizeReminderSelection(initialAutomation));
  const savedReminderSelection = useRef<ReminderSelection>(reminderSelectionFrom(normalizeReminderSelection(initialAutomation)));
  const [pendingReminderChange, setPendingReminderChange] = useState<{ count: number; previous: ReminderRuleKey | null; next: ReminderRuleKey | null } | null>(null);
  const [previewingReminderChange, setPreviewingReminderChange] = useState(false);
  const [savingReminderChange, setSavingReminderChange] = useState(false);
  const [messageTemplates, setMessageTemplates] = useState<Record<WhatsAppFixedMessageKey, string>>(() => normalizeConfirmationTemplates(resolveWhatsAppProductTemplates(productKey, status.automation.message_templates)));
  const [editingTemplate, setEditingTemplate] = useState<WhatsAppFixedMessageKey | null>(null);
  const [expandedTemplates, setExpandedTemplates] = useState<Partial<Record<WhatsAppFixedMessageKey, boolean>>>({});
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

  async function persistAutomation(reminderSelection = reminderSelectionFrom(automationRules)) {
    const saved = await runMutation(setMessage, async () => {
      await assertResult(await connectedClient().rpc("save_whatsapp_v2_automation_controls", {
        p_organization_id: organizationId,
        p_rules: {
          booking_client_enabled: automationRules.booking_client_enabled,
          booking_staff_enabled: automationRules.booking_staff_enabled,
          reminder_t24_enabled: reminderSelection.reminder_t24_enabled,
          reminder_morning_enabled: reminderSelection.reminder_morning_enabled,
          reminder_t180_enabled: reminderSelection.reminder_t180_enabled,
          reminder_t45_enabled: reminderSelection.reminder_t45_enabled,
          message_templates: messageTemplates,
        },
        p_custom_messages: customMessages,
      }));
    }, "Automações atualizadas.");
    if (saved) savedReminderSelection.current = reminderSelection;
    return saved;
  }

  async function previewReminderChange(nextReminderSelection: ReminderSelection) {
    const previousReminder = selectedReminder(savedReminderSelection.current);
    const nextReminder = selectedReminder(nextReminderSelection);
    if (previousReminder === nextReminder) return;

    setPreviewingReminderChange(true);
    try {
      const result = await connectedClient().rpc("preview_whatsapp_v2_presence_reminder_change", {
        p_organization_id: organizationId,
        p_rules: nextReminderSelection,
      });
      await assertResult(result);
      const count = Number(result.data ?? 0);
      setPendingReminderChange({
        count: Number.isFinite(count) ? Math.max(0, count) : 0,
        previous: previousReminder,
        next: nextReminder,
      });
    } catch (error) {
      setAutomationRules((current) => ({ ...current, ...savedReminderSelection.current }));
      setMessage(humanizeError(error));
    } finally {
      setPreviewingReminderChange(false);
    }
  }

  async function saveAutomation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (previewingReminderChange || pendingReminderChange) return;
    const nextReminderSelection = reminderSelectionFrom(automationRules);
    const previousReminder = selectedReminder(savedReminderSelection.current);
    const nextReminder = selectedReminder(nextReminderSelection);
    if (previousReminder !== nextReminder) {
      await previewReminderChange(nextReminderSelection);
      return;
    }
    const saved = await persistAutomation();
    if (saved) setMessage(customReady ? "Automações atualizadas. Mensagens personalizadas respeitarão consentimento, horário e limites de frequência." : "Automações atualizadas. Regras ativas valem somente para novos agendamentos confirmados; mensagens personalizadas continuam salvas sem envio nesta etapa.");
  }

  async function confirmReminderChange() {
    if (!pendingReminderChange) return;
    setSavingReminderChange(true);
    const saved = await persistAutomation(reminderSelectionFrom(automationRules));
    setSavingReminderChange(false);
    if (saved) {
      setPendingReminderChange(null);
      setMessage("Ativações e fluxos de confirmação de presença atualizados.");
      router.refresh();
    }
  }

  function cancelReminderChange() {
    setAutomationRules((current) => ({ ...current, ...savedReminderSelection.current }));
    setPendingReminderChange(null);
  }

  async function saveTemplate(key: WhatsAppFixedMessageKey) {
    if (!schemaReady) return;
    const saved = await persistAutomation(savedReminderSelection.current);
    if (saved) {
      setEditingTemplate(null);
      setMessage(`Texto de ${messageDefinitionTitle(key, productKey)} salvo.`);
    }
  }

  function insertVariable(key: WhatsAppFixedMessageKey, variable: string) {
    const editor = templateEditors.current[key];
    if (!editor) return;
    const currentText = isConfirmationReplyMessageKey(key)
      ? editableTemplateHeader(messageTemplates[key])
      : messageTemplates[key];
    const inserted = insertTemplateVariable(
      currentText,
      editor.selectionStart ?? currentText.length,
      editor.selectionEnd ?? currentText.length,
      variable,
    );
    if (isConfirmationReplyMessageKey(key) && withFixedConfirmationReply(inserted.value).length > 4096) return;
    pendingTemplateCursor.current = { key, cursor: inserted.cursor };
    setMessageTemplates((current) => ({ ...current, [key]: isConfirmationReplyMessageKey(key) ? withFixedConfirmationReply(inserted.value) : inserted.value }));
  }

  function updateAutomation(key: AutomationToggleKey, enabled: boolean) {
    if (reminderRuleKeys.includes(key as ReminderRuleKey)) {
      if (previewingReminderChange || pendingReminderChange) return;
      const nextRules = selectExclusiveReminder(automationRules, key as ReminderRuleKey, enabled);
      const nextReminderSelection = reminderSelectionFrom(nextRules);
      setAutomationRules(nextRules);
      if (selectedReminder(savedReminderSelection.current) !== selectedReminder(nextReminderSelection)) {
        void previewReminderChange(nextReminderSelection);
      }
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
      setMessage("Integração desconectada no sistema. Agora remova manualmente esta sessão no WhatsApp Business do celular: Aparelhos conectados → remova o dispositivo. Depois clique em Gerar QR e leia o novo código.");
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
    const title = localizeWhatsAppCopy(definition.title, productKey);
    const description = localizeWhatsAppCopy(definition.description, productKey);
    const editing = editingTemplate === definition.key;
    const expanded = expandedTemplates[definition.key] === true;
    const hasFixedReply = isConfirmationReplyMessageKey(definition.key);
    const templateText = hasFixedReply ? editableTemplateHeader(messageTemplates[definition.key]) : messageTemplates[definition.key];
    const editorLabel = hasFixedReply ? `Cabeçalho editável: ${title}` : `Texto: ${title}`;
    const contentId = `whatsapp-template-${definition.key}`;
    return <article className={styles.whatsappTemplateCard} key={definition.key}>
      <div className={styles.whatsappTemplateHead}>
        <button
          className={styles.whatsappTemplateToggle}
          type="button"
          aria-label={`${expanded ? "Recolher" : "Expandir"} mensagem: ${title}`}
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpandedTemplates((current) => ({ ...current, [definition.key]: !expanded }))}
        ><span className={styles.whatsappTemplateChevron} aria-hidden="true">›</span></button>
        <div><strong>{title}</strong><small>{description}</small></div>
        {definition.toggle
          ? <label className={styles.automationSwitch}>
              <span className="sr-only">Ativar {title}</span>
              <input type="checkbox" checked={automationRules[definition.toggle]} disabled={!schemaReady || previewingReminderChange || Boolean(pendingReminderChange)} onChange={(event) => updateAutomation(definition.toggle!, event.target.checked)} />
            </label>
          : <span className={styles.whatsappReplyBadge}>Enviada pelo fluxo</span>}
      </div>
      <div id={contentId} className={styles.whatsappTemplateBody} hidden={!expanded}>
        <Field label={editorLabel} wide>
          <textarea
            ref={(node) => { templateEditors.current[definition.key] = node; }}
            aria-label={editorLabel}
            value={templateText}
            disabled={!schemaReady || !editing}
            maxLength={hasFixedReply ? 4096 - fixedConfirmationReplyPrompt.length - 2 : 4096}
            onChange={(event) => setMessageTemplates((current) => ({ ...current, [definition.key]: hasFixedReply ? withFixedConfirmationReply(event.target.value) : event.target.value }))}
          />
        </Field>
        {hasFixedReply && <aside className={styles.whatsappFixedReply} aria-label={`Trecho fixo do fluxo: ${title}`}>
          <div><strong>Trecho fixo do fluxo</strong><span>Não editável</span></div>
          <pre>{fixedConfirmationReplyPrompt}</pre>
          <p>As opções 1, 2 e 3 controlam o fluxo de confirmação e não podem ser alteradas. Edite somente o cabeçalho acima.</p>
        </aside>}
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
      </div>
    </article>;
  }

  return <div className={`${styles.stack} settings-page ${productCopy.rootClass ? styles[productCopy.rootClass] : ""}`}>
    <PageHeader title="WhatsApp" description={`Conecte o WhatsApp da ${organizationName} e automatize avisos transacionais.`} />
    <ActionMessage message={message} />
    {!schemaReady && <p className={styles.message}>A estrutura conectada desta integração ainda aguarda a migration remota. A tela está pronta, mas salvar e conectar ficará disponível após a aplicação autorizada.</p>}

    <section className={`${styles.whatsappHero} ${productCopy.heroClass ? styles[productCopy.heroClass] : ""}`} aria-labelledby="whatsapp-title">
      <div>
        <span className={styles.whatsappEyebrow}>{productCopy.heroEyebrow}</span>
        <h1 id="whatsapp-title">{productCopy.heroTitle}</h1>
        <p>{productCopy.heroDescription}</p>
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

    <Panel title="Avisos do gestor" description={productCopy.managerNotificationDescription}>
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
        <details className={styles.whatsappMessageGroup}>
          <summary className={styles.whatsappMessageGroupSummary}><span className={styles.whatsappMessageChevron} aria-hidden="true">›</span><span><strong>{productCopy.bookingGroupTitle}</strong><small>{productCopy.bookingGroupDescription}</small></span></summary>
          <div className={styles.whatsappMessageGroupContent}>
            {bookingAndReminderMessages.map((definition) => fixedMessageCard(definition))}
            <div className={styles.rowActions}><button className={styles.button} type="submit" disabled={!schemaReady || previewingReminderChange || Boolean(pendingReminderChange)}>Salvar ativações</button></div>
          </div>
        </details>
        <details className={styles.whatsappMessageGroup}>
          <summary className={styles.whatsappMessageGroupSummary}><span className={styles.whatsappMessageChevron} aria-hidden="true">›</span><span><strong>Respostas e retornos</strong><small>{productCopy.responseGroupDescription}</small></span></summary>
          <div className={styles.whatsappMessageGroupContent}>
            {responseMessages.map((definition) => fixedMessageCard(definition))}
          </div>
        </details>
        <details className={styles.whatsappMessageGroup}>
          <summary className={styles.whatsappMessageGroupSummary}><span className={styles.whatsappMessageChevron} aria-hidden="true">›</span><span><strong>Mensagens de contratos</strong><small>Avisos enviados aos clientes quando o gestor cria um contrato de projeto ou uma assinatura.</small></span></summary>
          <div className={styles.whatsappMessageGroupContent}>
            {contractMessages.map((definition) => fixedMessageCard(definition))}
          </div>
        </details>
      </form>
    </Panel>

    <Panel
      title="Mensagens Personalizadas"
      titleAdornment={customReady ? undefined : <StatusChip active={false} tone="danger" label="FUNÇÃO EM BREVE" />}
      description={customReady ? localizeWhatsAppCopy("Pós-serviço, felicitações e campanhas. Até uma mensagem por dia e duas por semana para cada cliente.", productKey) : "Estas automações ainda não estão disponíveis para configuração ou envio."}
    >
      <form onSubmit={saveAutomation} className={styles.stack}>
        {customMessageGroups.map((group) => <details className={styles.whatsappMessageGroup} key={group.title}>
          <summary className={styles.whatsappMessageGroupSummary}><span className={styles.whatsappMessageChevron} aria-hidden="true">›</span><span><strong>{group.title === "Mensagens após o serviço" ? productCopy.customAfterServiceTitle : localizeWhatsAppCopy(group.title, productKey)}</strong></span></summary>
          <div className={styles.whatsappMessageGroupContent}>
            {group.messages.map((definition) => {
              const messageDefinition = customMessages.find((message) => message.key === definition.key)!;
              const title = localizeWhatsAppCopy(definition.title, productKey);
              return <article className={styles.customMessageRow} key={definition.key}>
                <div className={styles.automationRow}>
                  <div><strong>{title}</strong><small>{customReady ? "Exige preferência de marketing ativa." : "Disponível em uma próxima atualização."}</small></div>
                  <label className={styles.automationSwitch}>
                    <span className="sr-only">Ativar {title}</span>
                    <input type="checkbox" checked={messageDefinition.enabled} disabled={!customReady} onChange={(event) => updateCustom(definition.key, { enabled: event.target.checked })} />
                  </label>
                </div>
                <Field label={`Texto de ${title}`} wide>
                  <textarea aria-label={`Texto de ${title}`} value={messageDefinition.body} disabled={!customReady} maxLength={4096} onChange={(event) => updateCustom(definition.key, { body: event.target.value })} />
                </Field>
                <small className={styles.muted}>{customReady ? `Use {cliente} para incluir o nome do ${productCopy.terms.customer}. Salve antes de agendar.` : "Variáveis e personalização serão liberadas junto da função."}</small>
                {customReady && ["SPECIAL_DATES", "MARKETING_CAMPAIGNS"].includes(definition.key) && <button type="button" className={styles.button} disabled={!messageDefinition.enabled || !messageDefinition.body.trim()} onClick={() => setCampaignKey(definition.key)}>Agendar {title}</button>}
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
    {pendingReminderChange && <div className={styles.modalLayer} role="presentation">
      <button className={styles.modalBackdrop} type="button" aria-label="Cancelar alteração das confirmações de presença" onClick={cancelReminderChange} disabled={savingReminderChange} />
      <section className={`${styles.modal} ${styles.reminderChangeModal}`} role="alertdialog" aria-modal="true" aria-labelledby="reminder-change-title" aria-describedby="reminder-change-description">
        <h2 id="reminder-change-title">{pendingReminderChange.next ? "Alterar confirmação de presença?" : "Cancelar confirmações de presença?"}</h2>
        {pendingReminderChange.next ? <p id="reminder-change-description">
          A partir de agora, serão recalculados aproximadamente <strong>{pendingReminderChange.count}</strong> atendimentos futuros elegíveis, de {reminderLabel(pendingReminderChange.previous) ?? "sem aviso"} para {reminderLabel(pendingReminderChange.next)}. Se o novo horário do aviso já tiver passado e o atendimento ainda não tiver começado, a mensagem poderá ser enviada logo após a troca.
          <br /><br />Atendimentos que já receberam um aviso de presença não receberão outro, a menos que sejam reagendados. Pode haver instabilidade nos primeiros eventos.
        </p> : <p id="reminder-change-description">
          A partir de agora, serão cancelados os próximos envios de confirmação de presença de aproximadamente <strong>{pendingReminderChange.count}</strong> atendimentos futuros elegíveis. Pode haver instabilidade nos primeiros eventos.
        </p>}
        <div className={styles.reminderChangeActions}>
          <button type="button" className={`${styles.button} ${styles.buttonSoft}`} onClick={cancelReminderChange} disabled={savingReminderChange}>Cancelar</button>
          <button type="button" className={pendingReminderChange.next ? styles.button : `${styles.button} ${styles.buttonDanger}`} onClick={() => void confirmReminderChange()} disabled={savingReminderChange}>
            {savingReminderChange ? "Salvando…" : pendingReminderChange.next ? "Confirmar alteração" : "Confirmar cancelamento"}
          </button>
        </div>
      </section>
    </div>}
  </div>;
}
