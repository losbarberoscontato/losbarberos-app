import { appOrigin } from "../_shared/env.ts";
import {
  exchangeGoogleCode,
  getGoogleAccountEmail,
} from "../_shared/google-calendar.ts";
import { endpoint, redirect } from "../_shared/http.ts";
import {
  IntegrationError,
  safeReturnPath,
  sha256Hex,
} from "../_shared/security.ts";
import { rpc } from "../_shared/supabase.ts";

type OAuthStateContext = {
  organization_id: string;
  target_type: "ORGANIZATION" | "BARBER";
  barber_id: string | null;
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
      "consume_google_calendar_oauth_state",
      {
        p_state_hash: await sha256Hex(state),
      },
    );
    if (!context) {
      throw new IntegrationError(400, "INVALID_OAUTH_STATE");
    }
    const returnUrl = new URL(
      safeReturnPath(context.return_path, "/gestor/configuracoes"),
      appOrigin(),
    );
    const statusKey = context.target_type === "BARBER"
      ? "google_calendar_professional"
      : "google_calendar_organization";
    if (providerError || !code || code.length > 2048) {
      returnUrl.searchParams.set(statusKey, "canceled");
      return redirect(returnUrl.toString());
    }
    const token = await exchangeGoogleCode(code);
    const email = await getGoogleAccountEmail(token.access_token);
    const scopes = token.scope?.split(/\s+/u).filter(Boolean) ?? [];
    if (
      !scopes.includes("https://www.googleapis.com/auth/calendar.events.owned")
    ) {
      throw new IntegrationError(403, "GOOGLE_CALENDAR_SCOPE_MISSING");
    }
    await rpc("store_google_calendar_credentials", {
      p_organization_id: context.organization_id,
      p_target_type: context.target_type,
      p_barber_id: context.barber_id,
      p_google_account_email: email,
      p_access_token: token.access_token,
      p_refresh_token: token.refresh_token ?? null,
      p_expires_at: new Date(Date.now() + token.expires_in * 1_000)
        .toISOString(),
      p_scopes: scopes,
      p_connected_by_user_id: context.requested_by_user_id,
    });
    returnUrl.searchParams.set(statusKey, "connected");
    return redirect(returnUrl.toString());
  })
);
