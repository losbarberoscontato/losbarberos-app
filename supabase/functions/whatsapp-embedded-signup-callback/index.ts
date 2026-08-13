import { appOrigin } from "../_shared/env.ts";
import { endpoint, redirect } from "../_shared/http.ts";
import { IntegrationError, safeReturnPath, sha256Hex } from "../_shared/security.ts";
import { exchangeMetaSignupCode, metaGraphRequest } from "../_shared/whatsapp-meta.ts";
import { rpc } from "../_shared/supabase.ts";

type StateContext = { organization_id: string; requested_by_user_id: string; return_path: string };

function redirectWith(path: string, status: string): Response {
  const url = new URL(safeReturnPath(path, "/gestor/configuracoes/whatsapp"), appOrigin());
  url.searchParams.set("whatsapp", status);
  return redirect(url.toString());
}

Deno.serve((request) => endpoint(request, async () => {
  if (request.method !== "GET") throw new IntegrationError(405, "METHOD_NOT_ALLOWED");
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (!state || state.length > 512) throw new IntegrationError(400, "INVALID_CONNECTION_STATE");
  const context = await rpc<StateContext | null>("consume_whatsapp_connection_state", {
    p_provider: "META_CLOUD",
    p_state_hash: await sha256Hex(state),
  });
  if (!context) throw new IntegrationError(400, "INVALID_CONNECTION_STATE");
  if (!code || code.length > 4096) return redirectWith(context.return_path, "canceled");

  const accessToken = await exchangeMetaSignupCode(code);
  const business = await metaGraphRequest<{ data?: Array<{ id?: string; owned_whatsapp_business_accounts?: { data?: Array<{ id?: string; phone_numbers?: { data?: Array<{ id?: string }> } }> } }> }>(
    "/me/businesses?fields=id,owned_whatsapp_business_accounts{id,phone_numbers{id}}",
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  const account = business.data?.find((item) => item.owned_whatsapp_business_accounts?.data?.[0]);
  const waba = account?.owned_whatsapp_business_accounts?.data?.[0];
  const phoneNumberId = waba?.phone_numbers?.data?.[0]?.id;
  if (!account?.id || !waba?.id || !phoneNumberId) throw new IntegrationError(502, "META_BUSINESS_NOT_FOUND", true);

  await metaGraphRequest(`/${encodeURIComponent(waba.id)}/subscribed_apps`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  await rpc("store_whatsapp_meta_connection", {
    p_organization_id: context.organization_id,
    p_waba_id: waba.id,
    p_phone_number_id: phoneNumberId,
    p_access_token: accessToken,
    p_connected_by_user_id: context.requested_by_user_id,
  });
  return redirectWith(context.return_path, "connected");
}));
