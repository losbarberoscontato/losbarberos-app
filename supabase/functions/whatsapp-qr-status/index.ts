import { endpoint, json, preflight, readJson } from "../_shared/http.ts";
import { providerFetch } from "../_shared/provider-http.ts";
import { IntegrationError } from "../_shared/security.ts";
import {
  requireOrganizationOwner,
  requireUser,
  rpc,
} from "../_shared/supabase.ts";

type RequestBody = { organizationId?: unknown };
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

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

async function readProviderState(target: Target): Promise<string | null> {
  const result = await providerFetch<ConnectionStateResponse>(
    `${target.gateway_base_url.replace(/\/$/u, "")}/instance/connectionState/${
      encodeURIComponent(target.gateway_instance_id)
    }`,
    { method: "GET", headers: { apikey: target.gateway_api_key } },
  );
  const state = typeof result.instance?.state === "string"
    ? result.instance.state
    : typeof result.state === "string"
    ? result.state
    : null;
  return state?.trim().toLowerCase() ?? null;
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

    const target = (await rpc<Target[]>("get_whatsapp_qr_health_targets", {}))
      .find((item) => item.organization_id === organizationId);
    if (!target) throw new IntegrationError(404, "WHATSAPP_NOT_CONFIGURED");

    try {
      let state = await readProviderState(target);
      for (
        let attempt = 0;
        state === "connecting" && attempt < 15;
        attempt += 1
      ) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        state = await readProviderState(target);
      }
      if (!state) {
        await rpc("record_whatsapp_qr_health", {
          p_gateway_instance_id: target.gateway_instance_id,
          p_provider_state: null,
          p_error_code: "PROVIDER_STATE_MISSING",
        });
        throw new IntegrationError(502, "PROVIDER_STATE_MISSING", true);
      }
      await rpc("record_whatsapp_qr_health", {
        p_gateway_instance_id: target.gateway_instance_id,
        p_provider_state: state,
        p_error_code: state === "connecting" ? "PROVIDER_CONNECTING" : null,
      });
      return json(request, { checked: true, state });
    } catch (error) {
      if (
        error instanceof IntegrationError &&
        error.code === "PROVIDER_STATE_MISSING"
      ) throw error;
      await rpc("record_whatsapp_qr_health", {
        p_gateway_instance_id: target.gateway_instance_id,
        p_provider_state: null,
        p_error_code: error instanceof IntegrationError
          ? error.code
          : "GATEWAY_UNREACHABLE",
      });
      throw error;
    }
  });
});
