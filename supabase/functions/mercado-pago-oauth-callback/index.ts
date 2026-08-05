import { appOrigin } from "../_shared/env.ts";
import { endpoint, redirect } from "../_shared/http.ts";
import { exchangeMercadoPagoCode } from "../_shared/mercado-pago.ts";
import {
  IntegrationError,
  safeReturnPath,
  sha256Hex,
} from "../_shared/security.ts";
import { rpc } from "../_shared/supabase.ts";

type OAuthStateContext = {
  organization_id: string;
  requested_by_user_id: string;
  return_path: string;
};

Deno.serve((request) =>
  endpoint(request, async () => {
    if (request.method !== "GET") {
      throw new IntegrationError(405, "METHOD_NOT_ALLOWED");
    }

    const url = new URL(request.url);
    const state = url.searchParams.get("state") ?? "";
    const code = url.searchParams.get("code") ?? "";
    const providerError = url.searchParams.get("error");
    if (!state || state.length > 512) {
      throw new IntegrationError(400, "INVALID_OAUTH_STATE");
    }

    const context = await rpc<OAuthStateContext | null>(
      "consume_merchant_oauth_state",
      {
        p_provider: "MERCADO_PAGO",
        p_state_hash: await sha256Hex(state),
      },
    );
    if (!context) {
      throw new IntegrationError(400, "INVALID_OAUTH_STATE");
    }

    const returnPath = safeReturnPath(
      context.return_path,
      "/gestor/configuracoes",
    );
    const returnUrl = new URL(returnPath, appOrigin());

    if (providerError || !code || code.length > 512) {
      returnUrl.searchParams.set("mercado_pago", "canceled");
      return redirect(returnUrl.toString());
    }

    const token = await exchangeMercadoPagoCode(code);
    if (
      !token.access_token ||
      !Number.isSafeInteger(token.user_id) ||
      !Number.isSafeInteger(token.expires_in) ||
      token.expires_in < 1
    ) {
      throw new IntegrationError(502, "INVALID_PROVIDER_RESPONSE", true);
    }

    await rpc("store_merchant_oauth_credentials", {
      p_organization_id: context.organization_id,
      p_provider: "MERCADO_PAGO",
      p_external_account_id: String(token.user_id),
      p_access_token: token.access_token,
      p_refresh_token: token.refresh_token ?? null,
      p_token_type: token.token_type,
      p_scope: token.scope ?? null,
      p_expires_at: new Date(Date.now() + token.expires_in * 1_000)
        .toISOString(),
      p_connected_by_user_id: context.requested_by_user_id,
      p_live_mode: token.live_mode ?? null,
    });

    returnUrl.searchParams.set("mercado_pago", "connected");
    return redirect(returnUrl.toString());
  })
);
