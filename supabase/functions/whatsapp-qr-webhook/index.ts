import { requiredEnv } from "../_shared/env.ts";
import { endpoint, json } from "../_shared/http.ts";
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

function senderFromJid(value: string | undefined): string | null {
  if (!value || value.includes("@g.us") || value.includes("@broadcast")) return null;
  const digits = value.replace(/\D/gu, "");
  return digits.length >= 10 && digits.length <= 15 ? `+${digits}` : null;
}

function selectedAction(data: EvolutionMessageData | undefined): string | null {
  const message = data?.message;
  const token = message?.buttonsResponseMessage?.selectedButtonId ??
    message?.templateButtonReplyMessage?.selectedId ??
    message?.listResponseMessage?.singleSelectReply?.selectedRowId ??
    message?.conversation ??
    message?.extendedTextMessage?.text;
  return token?.trim() || null;
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
    return json(request, { received: true, updated });
  }

  if (event !== "MESSAGES_UPSERT") return json(request, { received: true });
  const externalMessageId = payload.data?.key?.id;
  const sender = senderFromJid(payload.data?.key?.remoteJid ?? payload.data?.key?.participant);
  const token = selectedAction(payload.data);
  if (payload.data?.key?.fromMe || !externalMessageId || !sender || !token || token === "keep_appointment") {
    return json(request, { received: true });
  }

  await rpc("process_whatsapp_action_token", {
    p_token_hash: await sha256Hex(token),
    p_sender_e164: sender,
    p_phone_number_id: payload.instance,
    p_external_message_id: externalMessageId,
    p_next_token: createOpaqueToken(32),
    p_next_token_expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
  });
  return json(request, { received: true, action: true });
}));
