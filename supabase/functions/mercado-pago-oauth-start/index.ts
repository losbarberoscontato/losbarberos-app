import { endpoint, json, preflight, readJson } from "../_shared/http.ts";
import { mercadoPagoAuthorizationUrl } from "../_shared/mercado-pago.ts";
import {
  createOpaqueToken,
  IntegrationError,
  safeReturnPath,
  sha256Hex,
} from "../_shared/security.ts";
import {
  requireOrganizationOwner,
  requireUser,
  rpc,
} from "../_shared/supabase.ts";

type RequestBody = { organizationId?: unknown; returnPath?: unknown };

const organizationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

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
    if (!organizationIdPattern.test(organizationId)) {
      throw new IntegrationError(400, "INVALID_ORGANIZATION_ID");
    }

    await requireOrganizationOwner(organizationId, user.id);

    const state = createOpaqueToken(32);
    const stateHash = await sha256Hex(state);
    const returnPath = safeReturnPath(
      body.returnPath,
      "/gestor/configuracoes",
    );
    await rpc("create_merchant_oauth_state", {
      p_organization_id: organizationId,
      p_provider: "MERCADO_PAGO",
      p_state_hash: stateHash,
      p_requested_by_user_id: user.id,
      p_return_path: returnPath,
      p_expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    });

    return json(request, {
      authorizationUrl: mercadoPagoAuthorizationUrl(state),
    }, 201);
  });
});
