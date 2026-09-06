import { requiredEnv } from "./env.ts";
import { providerFetch } from "./provider-http.ts";

export type MetaGraphObject = Record<string, unknown>;

export function metaGraphVersion(): string {
  const version = requiredEnv("WHATSAPP_GRAPH_API_VERSION");
  if (!/^v\d+\.\d+$/u.test(version)) {
    throw new TypeError("Invalid Meta Graph version");
  }
  return version;
}

export async function metaGraphRequest<
  T extends MetaGraphObject = MetaGraphObject,
>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const accessToken = typeof init.headers === "object" && init.headers
    ? new Headers(init.headers).get("authorization")
    : null;
  if (!accessToken) throw new TypeError("Meta access token required");
  return providerFetch<T>(
    `https://graph.facebook.com/${metaGraphVersion()}${path}`,
    {
      ...init,
      headers: {
        accept: "application/json",
        ...Object.fromEntries(new Headers(init.headers)),
      },
    },
  );
}

export async function exchangeMetaSignupCode(code: string): Promise<string> {
  const appId = requiredEnv("WHATSAPP_META_APP_ID");
  const appSecret = requiredEnv("WHATSAPP_META_APP_SECRET");
  const redirectUri = requiredEnv("WHATSAPP_META_REDIRECT_URI");
  const url = new URL(
    `https://graph.facebook.com/${metaGraphVersion()}/oauth/access_token`,
  );
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("code", code);
  url.searchParams.set("redirect_uri", redirectUri);
  const response = await providerFetch<{ access_token?: string }>(
    url.toString(),
    { method: "GET" },
  );
  if (!response.access_token) throw new TypeError("Meta token missing");
  return response.access_token;
}

export function metaAuthorizationUrl(state: string): string {
  const url = new URL(
    `https://www.facebook.com/${metaGraphVersion()}/dialog/oauth`,
  );
  url.searchParams.set("client_id", requiredEnv("WHATSAPP_META_APP_ID"));
  url.searchParams.set(
    "config_id",
    requiredEnv("WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID"),
  );
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set(
    "redirect_uri",
    requiredEnv("WHATSAPP_META_REDIRECT_URI"),
  );
  url.searchParams.set("override_default_response_type", "true");
  return url.toString();
}
