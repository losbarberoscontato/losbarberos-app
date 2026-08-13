import { requiredEnv } from "../_shared/env.ts";
import { endpoint, json } from "../_shared/http.ts";
import {
  createOpaqueToken,
  IntegrationError,
  sha256Hex,
  verifyMetaSignature,
} from "../_shared/security.ts";
import { rpc } from "../_shared/supabase.ts";
import { timingSafeEqual } from "../_shared/crypto.ts";

type WhatsAppStatus = {
  id?: string;
  status?: string;
  timestamp?: string;
  recipient_id?: string;
  errors?: Array<{ code?: number; title?: string }>;
};

type WhatsAppMessage = {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { payload?: string };
  interactive?: {
    button_reply?: { id?: string };
    list_reply?: { id?: string };
  };
};

type WebhookBody = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        statuses?: WhatsAppStatus[];
        messages?: WhatsAppMessage[];
        metadata?: { phone_number_id?: string };
      };
    }>;
  }>;
};

type ActionResult = { processed?: boolean } | null;

function deliveryStatus(status: string): string {
  switch (status) {
    case "sent":
      return "SENT";
    case "delivered":
      return "DELIVERED";
    case "read":
      return "READ";
    case "failed":
      return "FAILED";
    case "deleted":
      return "DELETED";
    default:
      return "UNKNOWN";
  }
}

function actionToken(message: WhatsAppMessage): string | null {
  return message.interactive?.button_reply?.id ??
    message.interactive?.list_reply?.id ??
    message.button?.payload ??
    null;
}

function providerTimestamp(value: string | undefined): string {
  if (!value || !/^\d{1,12}$/u.test(value)) return new Date().toISOString();
  const milliseconds = Number(value) * 1_000;
  if (!Number.isSafeInteger(milliseconds)) return new Date().toISOString();
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();
}

async function processIncomingMessage(
  message: WhatsAppMessage,
  receivingPhoneNumberId: string,
): Promise<void> {
  const sender = message.from ?? "";
  if (
    !/^\d{10,15}$/u.test(sender) ||
    !/^[A-Za-z0-9_-]{1,128}$/u.test(receivingPhoneNumberId) ||
    !message.id
  ) return;

  const normalizedText = message.text?.body?.trim().toLocaleLowerCase("pt-BR");
  if (
    ["sair", "stop", "parar", "cancelar mensagens"].includes(
      normalizedText ?? "",
    )
  ) {
    await rpc("record_whatsapp_opt_out", {
      p_external_message_id: message.id,
      p_sender_e164: `+${sender}`,
      p_phone_number_id: receivingPhoneNumberId,
      p_occurred_at: providerTimestamp(message.timestamp),
    });
    return;
  }

  const token = actionToken(message);
  if (!token || token === "keep_appointment" || token.length > 512) return;

  const nextToken = createOpaqueToken(32);
  const result = await rpc<ActionResult>("process_whatsapp_action_token", {
    p_token_hash: await sha256Hex(token),
    p_sender_e164: `+${sender}`,
    p_phone_number_id: receivingPhoneNumberId,
    p_external_message_id: message.id,
    p_next_token: nextToken,
    p_next_token_expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
  });
  if (!result) return;
  // RPC atomically consumes token, creates/enqueues second-step prompt when
  // needed, and applies/enqueues final cancellation confirmation on step two.
}

Deno.serve((request) =>
  endpoint(request, async () => {
    if (request.method === "GET") {
      const url = new URL(request.url);
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token") ?? "";
      const challenge = url.searchParams.get("hub.challenge") ?? "";
      if (
        mode !== "subscribe" ||
        !timingSafeEqual(token, requiredEnv("WHATSAPP_VERIFY_TOKEN")) ||
        !/^\d{1,64}$/u.test(challenge)
      ) {
        throw new IntegrationError(403, "WEBHOOK_VERIFICATION_FAILED");
      }
      return new Response(challenge, {
        status: 200,
        headers: { "cache-control": "no-store", "content-type": "text/plain" },
      });
    }

    if (request.method !== "POST") {
      throw new IntegrationError(405, "METHOD_NOT_ALLOWED");
    }

    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 1_048_576) {
      throw new IntegrationError(413, "PAYLOAD_TOO_LARGE");
    }
    if (
      !await verifyMetaSignature(
        rawBody,
        request.headers.get("x-hub-signature-256"),
        requiredEnv("WHATSAPP_META_APP_SECRET"),
      )
    ) {
      throw new IntegrationError(401, "INVALID_SIGNATURE");
    }

    let payload: WebhookBody;
    try {
      payload = JSON.parse(rawBody) as WebhookBody;
    } catch {
      throw new IntegrationError(400, "INVALID_JSON");
    }
    if (payload.object !== "whatsapp_business_account") {
      throw new IntegrationError(400, "INVALID_WEBHOOK_PAYLOAD");
    }

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== "messages") {
          continue;
        }

        const receivingPhoneNumberId =
          change.value?.metadata?.phone_number_id ?? "";
        for (const status of change.value?.statuses ?? []) {
          if (!status.id || !status.status) continue;
          await rpc("process_whatsapp_delivery_status", {
            p_event_id: `${status.id}:${status.status}:${
              status.timestamp ?? ""
            }`,
            p_external_message_id: status.id,
            p_status: deliveryStatus(status.status),
            p_occurred_at: providerTimestamp(status.timestamp),
            p_recipient_id: status.recipient_id ?? null,
            p_phone_number_id: receivingPhoneNumberId,
            p_errors: (status.errors ?? []).map((error) => ({
              code: error.code ?? null,
              title: error.title?.slice(0, 255) ?? null,
            })),
          });
        }

        for (const message of change.value?.messages ?? []) {
          await processIncomingMessage(message, receivingPhoneNumberId);
        }
      }
    }

    return json(request, { received: true });
  })
);
