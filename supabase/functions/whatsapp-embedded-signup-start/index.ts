import { endpoint, json, preflight, readJson } from "../_shared/http.ts";
import { requiredEnv } from "../_shared/env.ts";
import { createOpaqueToken, IntegrationError, safeReturnPath, sha256Hex } from "../_shared/security.ts";
import { metaAuthorizationUrl } from "../_shared/whatsapp-meta.ts";
import { requireOrganizationOwner, requireUser, rpc } from "../_shared/supabase.ts";

type RequestBody = { organizationId?: unknown; returnPath?: unknown };
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

    const state = createOpaqueToken(32);
    await rpc("create_whatsapp_connection_state", {
      p_organization_id: organizationId,
      p_provider: "META_CLOUD",
      p_state_hash: await sha256Hex(state),
      p_requested_by_user_id: user.id,
      p_return_path: safeReturnPath(body.returnPath, "/gestor/configuracoes/whatsapp"),
      p_expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    });

    return json(request, {
      appId: requiredEnv("WHATSAPP_META_APP_ID"),
      configurationId: requiredEnv("WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID"),
      state,
      authorizationUrl: metaAuthorizationUrl(state),
    }, 201);
  });
});
