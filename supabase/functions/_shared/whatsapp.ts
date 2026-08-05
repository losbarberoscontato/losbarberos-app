import { requiredEnv } from "./env.ts";
import { providerFetch } from "./provider-http.ts";

type WhatsAppResponse = {
  messages?: Array<{ id: string }>;
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

export function defaultWhatsAppSender() {
  return {
    accessToken: requiredEnv("WHATSAPP_ACCESS_TOKEN"),
    phoneNumberId: requiredEnv("WHATSAPP_PHONE_NUMBER_ID"),
  };
}

export function normalizeWhatsAppRecipient(value: string): string {
  const digits = value.replace(/\D/gu, "");
  if (digits.length < 10 || digits.length > 15) {
    throw new TypeError("Invalid recipient");
  }
  return digits;
}
