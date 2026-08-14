import { functionUrl, requiredEnv } from "../_shared/env.ts";
import { endpoint, json, preflight, readJson } from "../_shared/http.ts";
import { providerFetch } from "../_shared/provider-http.ts";
import { IntegrationError } from "../_shared/security.ts";
import { requireOrganizationOwner, requireUser, rpc } from "../_shared/supabase.ts";

type RequestBody = { organizationId?: unknown };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

Deno.serve((request) => {
  const options = preflight(request);
  if (options) return options;
  return endpoint(request, async () => {
    if (request.method !== "POST") throw new IntegrationError(405, "METHOD_NOT_ALLOWED");
    const user = await requireUser(request);
    const body = await readJson<RequestBody>(request);
    const organizationId = typeof body.organizationId === "string" ? body.organizationId : "";
    if (!uuidPattern.test(organizationId)) throw new IntegrationError(400, "INVALID_ORGANIZATION_ID");
    await requireOrganizationOwner(organizationId, user.id);

    const baseUrl = requiredEnv("EVOLUTION_API_BASE_URL").replace(/\/$/u, "");
    if (!/^https:\/\//u.test(baseUrl)) throw new IntegrationError(500, "SERVER_CONFIGURATION_ERROR");
    const apiKey = requiredEnv("EVOLUTION_API_KEY");
    const webhookSecret = requiredEnv("EVOLUTION_WEBHOOK_SECRET");
    const instanceName = `lb-${organizationId.slice(0, 8)}`;
    await providerFetch(`${baseUrl}/instance/create`, {
      method: "POST",
      headers: { apikey: apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        instanceName,
        integration: "WHATSAPP-BAILEYS",
        qrcode: true,
        webhook: {
          enabled: true,
          url: functionUrl("whatsapp-qr-webhook"),
          byEvents: false,
          base64: false,
          headers: { "x-evolution-webhook-secret": webhookSecret },
          events: ["CONNECTION_UPDATE"],
        },
      }),
    });
    const connection = await rpc<{ id: string }>("store_whatsapp_qr_connection", {
      p_organization_id: organizationId,
      p_gateway_base_url: baseUrl,
      p_gateway_instance_id: instanceName,
      p_gateway_api_key: apiKey,
      p_requested_by_user_id: user.id,
    });
    const qr = await providerFetch<Record<string, unknown>>(`${baseUrl}/instance/connect/${encodeURIComponent(instanceName)}`, {
      method: "GET",
      headers: { apikey: apiKey },
    });
    const qrCode = typeof qr.base64 === "string" && qr.base64.length < 200_000 ? qr.base64 : null;
    return json(request, { connectionId: connection.id, instanceName, qrCode }, 201);
  });
});
