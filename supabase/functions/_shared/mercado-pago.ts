import { functionUrl, requiredEnv } from "./env.ts";
import { providerFetch } from "./provider-http.ts";
import { IntegrationError } from "./security.ts";
import { rpc } from "./supabase.ts";

const API_BASE = "https://api.mercadopago.com";
const AUTHORIZATION_URL = "https://auth.mercadopago.com.br/authorization";

export type MercadoPagoOAuthToken = {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
  user_id: number;
  refresh_token?: string;
  public_key?: string;
  live_mode?: boolean;
};

export type MercadoPagoPreference = {
  id: string;
  init_point: string;
  sandbox_init_point?: string;
};

export type MercadoPagoPayment = {
  id: number;
  status: string;
  status_detail?: string;
  transaction_amount: number;
  currency_id: string;
  external_reference?: string | null;
  collector_id: number;
  date_approved?: string | null;
  money_release_date?: string | null;
  metadata?: Record<string, unknown>;
  refunds?: Array<{ id: number; amount: number; status?: string }>;
};

export function mercadoPagoRedirectUri(): string {
  return functionUrl("mercado-pago-oauth-callback");
}

export function mercadoPagoAuthorizationUrl(state: string): string {
  const url = new URL(AUTHORIZATION_URL);
  url.searchParams.set("client_id", requiredEnv("MERCADO_PAGO_CLIENT_ID"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("platform_id", "mp");
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", mercadoPagoRedirectUri());
  url.searchParams.set("scope", "offline_access read write");
  return url.toString();
}

export function exchangeMercadoPagoCode(code: string) {
  return providerFetch<MercadoPagoOAuthToken>(`${API_BASE}/oauth/token`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: requiredEnv("MERCADO_PAGO_CLIENT_ID"),
      client_secret: requiredEnv("MERCADO_PAGO_CLIENT_SECRET"),
      grant_type: "authorization_code",
      code,
      redirect_uri: mercadoPagoRedirectUri(),
    }),
  });
}

type MercadoPagoTokenContext = {
  organization_id: string;
  external_account_id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string | null;
};

type StoredMercadoPagoToken = {
  access_token: string;
  external_account_id: string;
  token_expires_at: string;
  updated: boolean;
};

const TOKEN_REFRESH_WINDOW_MS = 7 * 86_400_000;

function refreshMercadoPagoToken(refreshToken: string) {
  return providerFetch<MercadoPagoOAuthToken>(`${API_BASE}/oauth/token`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: requiredEnv("MERCADO_PAGO_CLIENT_ID"),
      client_secret: requiredEnv("MERCADO_PAGO_CLIENT_SECRET"),
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
}

export async function mercadoPagoAccessToken(
  organizationId: string,
): Promise<string> {
  const context = await rpc<MercadoPagoTokenContext | null>(
    "get_merchant_token_refresh_context",
    { p_organization_id: organizationId },
  );
  if (!context?.access_token || !context.refresh_token) {
    throw new IntegrationError(503, "MERCADO_PAGO_REAUTH_REQUIRED", true, 3600);
  }

  const expiresAt = Date.parse(context.token_expires_at ?? "");
  if (
    Number.isFinite(expiresAt) &&
    expiresAt > Date.now() + TOKEN_REFRESH_WINDOW_MS
  ) {
    return context.access_token;
  }

  let refreshed: MercadoPagoOAuthToken;
  try {
    refreshed = await refreshMercadoPagoToken(context.refresh_token);
  } catch (error) {
    if (error instanceof IntegrationError && !error.retryable) {
      await rpc("mark_merchant_reauth_required", {
        p_organization_id: organizationId,
        p_reason: "mercado_pago_refresh_rejected",
      });
      throw new IntegrationError(
        503,
        "MERCADO_PAGO_REAUTH_REQUIRED",
        true,
        3600,
      );
    }
    throw error;
  }

  if (
    !refreshed.access_token || !refreshed.refresh_token ||
    !Number.isSafeInteger(refreshed.user_id) ||
    String(refreshed.user_id) !== context.external_account_id ||
    !Number.isSafeInteger(refreshed.expires_in) || refreshed.expires_in < 1
  ) {
    throw new IntegrationError(502, "INVALID_PROVIDER_RESPONSE", true);
  }

  const stored = await rpc<StoredMercadoPagoToken>(
    "store_refreshed_merchant_oauth_credentials",
    {
      p_organization_id: organizationId,
      p_expected_refresh_token: context.refresh_token,
      p_access_token: refreshed.access_token,
      p_refresh_token: refreshed.refresh_token,
      p_expires_at: new Date(Date.now() + refreshed.expires_in * 1_000)
        .toISOString(),
      p_scope: refreshed.scope ?? null,
    },
  );
  if (
    !stored?.access_token ||
    stored.external_account_id !== context.external_account_id
  ) {
    throw new IntegrationError(502, "INVALID_TOKEN_PERSISTENCE_RESPONSE", true);
  }
  return stored.access_token;
}

export function mercadoPagoRequest<T>(
  path: string,
  accessToken: string,
  init: RequestInit = {},
  idempotencyKey?: string,
): Promise<T> {
  return providerFetch<T>(`${API_BASE}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(idempotencyKey ? { "x-idempotency-key": idempotencyKey } : {}),
      ...init.headers,
    },
  });
}
