import { requiredEnv } from "../_shared/env.ts";
import { endpoint, json } from "../_shared/http.ts";
import { providerFetch } from "../_shared/provider-http.ts";
import {
  createOpaqueToken,
  IntegrationError,
  sha256Hex,
  verifySharedSecretHeader,
} from "../_shared/security.ts";
import { rpc } from "../_shared/supabase.ts";

type EvolutionMessage = {
  conversation?: string;
  extendedTextMessage?: { text?: string };
  buttonsResponseMessage?: { selectedButtonId?: string };
  templateButtonReplyMessage?: { selectedId?: string };
  listResponseMessage?: { singleSelectReply?: { selectedRowId?: string } };
};

type EvolutionMessageData = {
  key?: { id?: string; remoteJid?: string; participant?: string; fromMe?: boolean };
  message?: EvolutionMessage;
};

type EvolutionPayload = {
  event?: string;
  instance?: string;
  data?: {
    state?: string;
    statusReason?: string;
    base64?: string;
    qrcode?: { base64?: string };
  } & EvolutionMessageData;
};

type EvolutionInstanceInfo = {
  ownerJid?: unknown;
  number?: unknown;
  instance?: { ownerJid?: unknown; number?: unknown };
};

function senderFromJid(value: string | undefined): string | null {
  if (!value || value.includes("@g.us") || value.includes("@broadcast")) return null;
  const digits = value.replace(/\D/gu, "");
  return digits.length >= 10 && digits.length <= 15 ? `+${digits}` : null;
}

function connectedPhoneFromPayload(payload: unknown): string | null {
  const values = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : [payload];
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    const instance = value as EvolutionInstanceInfo;
    const candidates = [instance.ownerJid, instance.number, instance.instance?.ownerJid, instance.instance?.number];
    for (const candidate of candidates) {
      if (typeof candidate !== "string") continue;
      const phone = senderFromJid(candidate);
      if (phone) return phone;
    }
  }
  return null;
}

async function syncConnectedPhone(instanceName: string): Promise<boolean> {
  const baseUrl = requiredEnv("EVOLUTION_API_BASE_URL").replace(/\/$/u, "");
  const url = new URL(`${baseUrl}/instance/fetchInstances`);
  url.searchParams.set("instanceName", instanceName);
  const payload = await providerFetch<unknown>(url.toString(), {
    method: "GET",
    headers: { apikey: requiredEnv("EVOLUTION_API_KEY") },
  });
  const phone = connectedPhoneFromPayload(payload);
  if (!phone) return false;
  return await rpc<boolean>("store_whatsapp_qr_connected_phone", {
    p_gateway_instance_id: instanceName,
    p_connected_phone_e164: phone,
  });
}

async function trySyncConnectedPhone(instanceName: string, eventPayload?: unknown): Promise<void> {
  try {
    const eventPhone = connectedPhoneFromPayload(eventPayload);
    if (eventPhone) {
      await rpc("store_whatsapp_qr_connected_phone", {
        p_gateway_instance_id: instanceName,
        p_connected_phone_e164: eventPhone,
      });
      return;
    }
    await syncConnectedPhone(instanceName);
  } catch (error) {
    console.error("whatsapp_connected_phone_sync_failed", {
      instanceName,
      errorCode: error instanceof IntegrationError ? error.code : "UNKNOWN_ERROR",
    });
  }
}

function selectedAction(data: EvolutionMessageData | undefined): string | null {
  const message = data?.message;
  const token = message?.buttonsResponseMessage?.selectedButtonId ??
    message?.templateButtonReplyMessage?.selectedId ??
    message?.listResponseMessage?.singleSelectReply?.selectedRowId;
  return token?.trim() || null;
}

function textReply(data: EvolutionMessageData | undefined): string | null {
  const value = data?.message?.conversation ?? data?.message?.extendedTextMessage?.text;
  return value?.trim() || null;
}

Deno.serve((request) => endpoint(request, async () => {
  if (request.method !== "POST") throw new IntegrationError(405, "METHOD_NOT_ALLOWED");
  const rawBody = await request.text();
  if (!verifySharedSecretHeader(request.headers.get("x-evolution-webhook-secret"), requiredEnv("EVOLUTION_WEBHOOK_SECRET"))) {
    throw new IntegrationError(401, "INVALID_SIGNATURE");
  }
  let payload: EvolutionPayload;
  try {
    payload = JSON.parse(rawBody) as EvolutionPayload;
  } catch {
    throw new IntegrationError(400, "INVALID_JSON");
  }
  if (!payload.instance) {
    return json(request, { received: true });
  }

  const event = payload.event?.toUpperCase().replaceAll(".", "_");
  if (event === "QRCODE_UPDATED") {
    const qrCode = payload.data?.base64 ?? payload.data?.qrcode?.base64 ?? null;
    if (!qrCode) return json(request, { received: true, qrStored: false });
    await rpc("store_whatsapp_qr_code", {
      p_gateway_instance_id: payload.instance,
      p_qr_code: qrCode,
      p_expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
    return json(request, { received: true, qrStored: true });
  }

  if (event === "CONNECTION_UPDATE" && payload.data?.state) {
    const updated = await rpc<boolean>("update_whatsapp_qr_status", {
      p_gateway_instance_id: payload.instance,
      p_status: payload.data.state,
      p_error_code: payload.data.statusReason?.slice(0, 255) ??
        (payload.data.state.toLowerCase() === "connecting" ? "PROVIDER_CONNECTING" : null),
    });
    if (["open", "connected"].includes(payload.data.state.toLowerCase())) {
      await trySyncConnectedPhone(payload.instance, payload.data);
    }
    return json(request, { received: true, updated });
  }

  if (event !== "MESSAGES_UPSERT") return json(request, { received: true });
  const externalMessageId = payload.data?.key?.id;
  const sender = senderFromJid(payload.data?.key?.remoteJid ?? payload.data?.key?.participant);
  const token = selectedAction(payload.data);
  const reply = textReply(payload.data);
  if (payload.data?.key?.fromMe || !externalMessageId || !sender || (!token && !reply) || token === "keep_appointment") {
    return json(request, { received: true });
  }

  await trySyncConnectedPhone(payload.instance, payload.data);

  const actionInput = {
    p_sender_e164: sender,
    p_phone_number_id: payload.instance,
    p_external_message_id: externalMessageId,
    p_next_token: createOpaqueToken(32),
    p_next_token_expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
  };
  if (token) {
    await rpc("process_whatsapp_action_token", { ...actionInput, p_token_hash: await sha256Hex(token) });
  } else if (reply && !/^\d+$/u.test(reply)) {
    await rpc("forward_unrecognized_whatsapp_message", {
      p_sender_e164: sender,
      p_phone_number_id: payload.instance,
      p_external_message_id: externalMessageId,
      p_text: reply,
    });
  } else {
    await rpc("process_whatsapp_text_action", { ...actionInput, p_reply: reply });
  }
  return json(request, { received: true, action: true });
}));
