import { functionUrl, requiredEnv } from "./env.ts";
import { providerFetch } from "./provider-http.ts";

export const whatsappQrWebhookEvents = [
  "QRCODE_UPDATED",
  "CONNECTION_UPDATE",
  "MESSAGES_UPSERT",
  "MESSAGES_UPDATE",
] as const;

export function evolutionQrWebhookConfig() {
  return {
    enabled: true,
    url: functionUrl("whatsapp-qr-webhook"),
    byEvents: false,
    base64: true,
    headers: {
      "x-evolution-webhook-secret": requiredEnv("EVOLUTION_WEBHOOK_SECRET"),
    },
    events: whatsappQrWebhookEvents,
  };
}

export async function configureEvolutionQrWebhook(
  baseUrl: string,
  instanceName: string,
  apiKey: string,
): Promise<void> {
  await providerFetch<unknown>(
    `${baseUrl.replace(/\/$/u, "")}/webhook/set/${encodeURIComponent(instanceName)}`,
    {
      method: "POST",
      headers: { apikey: apiKey, "content-type": "application/json" },
      body: JSON.stringify({ webhook: evolutionQrWebhookConfig() }),
    },
  );
}
