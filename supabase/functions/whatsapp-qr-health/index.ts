import { endpoint, json } from "../_shared/http.ts";
import { configureEvolutionQrWebhook } from "../_shared/evolution-qr-webhook.ts";
import { providerFetch } from "../_shared/provider-http.ts";
import { IntegrationError } from "../_shared/security.ts";
import { requireServiceInvocation, rpc } from "../_shared/supabase.ts";

type Target = {
  organization_id: string;
  gateway_instance_id: string;
  gateway_base_url: string;
  gateway_api_key: string;
};

type ConnectionStateResponse = {
  instance?: { state?: unknown };
  state?: unknown;
};

Deno.serve((request) => endpoint(request, async () => {
  if (request.method !== "POST") throw new IntegrationError(405, "METHOD_NOT_ALLOWED");
  requireServiceInvocation(request);

  const targets = await rpc<Target[]>("get_whatsapp_qr_health_targets", {});
  let healthy = 0;
  for (const target of targets) {
    try {
      try {
        // This also repairs instances created before inbound message events
        // were part of the Evolution webhook subscription.
        await configureEvolutionQrWebhook(
          target.gateway_base_url,
          target.gateway_instance_id,
          target.gateway_api_key,
        );
      } catch {
        await rpc("record_whatsapp_qr_health", {
          p_gateway_instance_id: target.gateway_instance_id,
          p_provider_state: "error",
          p_error_code: "WEBHOOK_CONFIGURATION_FAILED",
        });
        continue;
      }
      const result = await providerFetch<ConnectionStateResponse>(
        `${target.gateway_base_url.replace(/\/$/u, "")}/instance/connectionState/${encodeURIComponent(target.gateway_instance_id)}`,
        { method: "GET", headers: { apikey: target.gateway_api_key } },
      );
      const rawState = typeof result.instance?.state === "string"
        ? result.instance.state
        : typeof result.state === "string" ? result.state : null;
      const state = rawState?.trim().toLowerCase() ?? null;
      await rpc("record_whatsapp_qr_health", {
        p_gateway_instance_id: target.gateway_instance_id,
        p_provider_state: state,
        p_error_code: state === "connecting"
          ? "PROVIDER_CONNECTING"
          : state ? null : "PROVIDER_STATE_MISSING",
      });
      if (state === "open") healthy += 1;
    } catch (error) {
      await rpc("record_whatsapp_qr_health", {
        p_gateway_instance_id: target.gateway_instance_id,
        p_provider_state: null,
        p_error_code: error instanceof IntegrationError ? error.code : "GATEWAY_UNREACHABLE",
      });
    }
  }

  return json(request, { checked: targets.length, healthy });
}));
