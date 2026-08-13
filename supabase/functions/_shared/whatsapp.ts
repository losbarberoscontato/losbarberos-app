import { requiredEnv } from "./env.ts";
import { providerFetch } from "./provider-http.ts";
import { IntegrationError } from "./security.ts";
import { rpc } from "./supabase.ts";

type WhatsAppResponse = {
  messages?: Array<{ id: string }>;
};

export type WhatsAppSender =
  | { provider: "META_CLOUD"; phoneNumberId: string; accessToken: string }
  | { provider: "QR_WEB"; gatewayBaseUrl: string; gatewayInstanceId: string; gatewayApiKey: string };

type SenderContext = {
  provider?: unknown;
  phone_number_id?: unknown;
  access_token?: unknown;
  gateway_base_url?: unknown;
  gateway_instance_id?: unknown;
  gateway_api_key?: unknown;
};

function graphVersion(): string {
  const configured = requiredEnv("WHATSAPP_GRAPH_API_VERSION");
  if (!/^v\d+\.\d+$/u.test(configured)) {
    throw new TypeError("Invalid WhatsApp Graph API version");
  }
  return configured;
}

export function whatsappRequest(
  phoneNumberId: string,
  accessToken: string,
  message: Record<string, unknown>,
): Promise<WhatsAppResponse> {
  return providerFetch<WhatsAppResponse>(
    `https://graph.facebook.com/${graphVersion()}/${
      encodeURIComponent(phoneNumberId)
    }/messages`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", ...message }),
    },
  );
}

export async function whatsappSenderForOrganization(
  organizationId: string,
): Promise<WhatsAppSender> {
  const context = await rpc<SenderContext | null>("get_whatsapp_sender_context", {
    p_organization_id: organizationId,
  });
  if (!context || typeof context.provider !== "string") {
    throw new IntegrationError(503, "WHATSAPP_NOT_CONNECTED", true);
  }

  if (
    context.provider === "META_CLOUD" &&
    typeof context.phone_number_id === "string" &&
    typeof context.access_token === "string"
  ) {
    return {
      provider: "META_CLOUD",
      phoneNumberId: context.phone_number_id,
      accessToken: context.access_token,
    };
  }

  if (
    context.provider === "QR_WEB" &&
    typeof context.gateway_base_url === "string" &&
    typeof context.gateway_instance_id === "string" &&
    typeof context.gateway_api_key === "string"
  ) {
    return {
      provider: "QR_WEB",
      gatewayBaseUrl: context.gateway_base_url.replace(/\/$/u, ""),
      gatewayInstanceId: context.gateway_instance_id,
      gatewayApiKey: context.gateway_api_key,
    };
  }

  throw new IntegrationError(503, "WHATSAPP_CONNECTION_INCOMPLETE", true);
}

export function evolutionRequest(
  sender: Extract<WhatsAppSender, { provider: "QR_WEB" }>,
  recipient: string,
  text: string,
): Promise<WhatsAppResponse> {
  if (!text.trim() || text.length > 4_096) {
    throw new IntegrationError(422, "INVALID_OUTBOX_MESSAGE");
  }
  return providerFetch<WhatsAppResponse>(
    `${sender.gatewayBaseUrl}/message/sendText/${encodeURIComponent(sender.gatewayInstanceId)}`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        apikey: sender.gatewayApiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ number: normalizeWhatsAppRecipient(recipient), text }),
    },
  );
}

export function normalizeWhatsAppRecipient(value: string): string {
  const digits = value.replace(/\D/gu, "");
  if (digits.length < 10 || digits.length > 15) {
    throw new TypeError("Invalid recipient");
  }
  return digits;
}
