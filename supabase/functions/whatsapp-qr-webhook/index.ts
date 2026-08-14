import { requiredEnv } from "../_shared/env.ts";
import { endpoint, json } from "../_shared/http.ts";
import { IntegrationError, verifySharedSecretHeader } from "../_shared/security.ts";
import { rpc } from "../_shared/supabase.ts";

type EvolutionPayload = {
  event?: string;
  instance?: string;
  data?: { state?: string; statusReason?: string };
};

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
  if (payload.event !== "CONNECTION_UPDATE" || !payload.instance || !payload.data?.state) {
    return json(request, { received: true });
  }
  const updated = await rpc<boolean>("update_whatsapp_qr_status", {
    p_gateway_instance_id: payload.instance,
    p_status: payload.data.state,
    p_error_code: payload.data.statusReason?.slice(0, 255) ?? null,
  });
  return json(request, { received: true, updated });
}));
