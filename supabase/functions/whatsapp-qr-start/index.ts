import { requiredEnv } from "../_shared/env.ts";
import {
  configureEvolutionQrWebhook,
  evolutionQrWebhookConfig,
} from "../_shared/evolution-qr-webhook.ts";
import { endpoint, json, preflight, readJson } from "../_shared/http.ts";
import { providerFetch } from "../_shared/provider-http.ts";
import { IntegrationError } from "../_shared/security.ts";
import {
  requireOrganizationOwner,
  requireUser,
  rpc,
} from "../_shared/supabase.ts";

type RequestBody = { organizationId?: unknown };
type EvolutionQrPayload = {
  base64?: unknown;
  qrcode?: { base64?: unknown };
  data?: { base64?: unknown; qrcode?: { base64?: unknown } };
};
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function extractQrCode(payload: EvolutionQrPayload | null): string | null {
  const candidates = [
    payload?.base64,
    payload?.qrcode?.base64,
    payload?.data?.base64,
    payload?.data?.qrcode?.base64,
  ];
  const qrCode = candidates.find((value): value is string =>
    typeof value === "string" && value.length > 100 && value.length < 300_000
  );
  return qrCode ?? null;
}

Deno.serve((request) => {
  const options = preflight(request);
  if (options) return options;
  return endpoint(request, async () => {
    if (request.method !== "POST") {
      throw new IntegrationError(405, "METHOD_NOT_ALLOWED");
    }
    const user = await requireUser(request);
    const body = await readJson<RequestBody>(request);
    const organizationId = typeof body.organizationId === "string"
      ? body.organizationId
      : "";
    if (!uuidPattern.test(organizationId)) {
      throw new IntegrationError(400, "INVALID_ORGANIZATION_ID");
    }
    await requireOrganizationOwner(organizationId, user.id);

    const baseUrl = requiredEnv("EVOLUTION_API_BASE_URL").replace(/\/$/u, "");
    if (!/^https:\/\//u.test(baseUrl)) {
      throw new IntegrationError(500, "SERVER_CONFIGURATION_ERROR");
    }
    const apiKey = requiredEnv("EVOLUTION_API_KEY");
    const instanceName = `lb-${organizationId.slice(0, 8)}`;
    let created: EvolutionQrPayload | null = null;
    try {
      created = await providerFetch<EvolutionQrPayload>(
        `${baseUrl}/instance/create`,
        {
          method: "POST",
          headers: { apikey: apiKey, "content-type": "application/json" },
          body: JSON.stringify({
            instanceName,
            integration: "WHATSAPP-BAILEYS",
            qrcode: true,
            webhook: evolutionQrWebhookConfig(),
          }),
        },
      );
    } catch (error) {
      // Reconnect calls create with the stable instance name. Evolution returns
      // 4xx when that instance already exists; connect below is the idempotent
      // continuation for this expected case.
      if (!(error instanceof IntegrationError) || error.status !== 422) {
        throw error;
      }
    }
    // Existing stable instances keep the webhook configuration from the day
    // they were created. Reapply it so reconnecting also enables inbound
    // MESSAGES_UPSERT replies.
    await configureEvolutionQrWebhook(baseUrl, instanceName, apiKey);
    const connection = await rpc<{ id: string }>(
      "store_whatsapp_qr_connection",
      {
        p_organization_id: organizationId,
        p_gateway_base_url: baseUrl,
        p_gateway_instance_id: instanceName,
        p_gateway_api_key: apiKey,
        p_requested_by_user_id: user.id,
      },
    );
    const qr = await providerFetch<EvolutionQrPayload>(
      `${baseUrl}/instance/connect/${encodeURIComponent(instanceName)}`,
      {
        method: "GET",
        headers: { apikey: apiKey },
      },
    );
    const qrCode = extractQrCode(qr) ?? extractQrCode(created);
    if (qrCode) {
      await rpc("store_whatsapp_qr_code", {
        p_gateway_instance_id: instanceName,
        p_qr_code: qrCode,
        p_expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      });
    }
    return json(request, {
      connectionId: connection.id,
      instanceName,
      qrCode,
      qrAvailable: Boolean(qrCode),
    }, 201);
  });
});
