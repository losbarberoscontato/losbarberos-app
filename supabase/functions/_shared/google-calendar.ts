import { requiredEnv } from "./env.ts";
import { IntegrationError } from "./security.ts";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_API = "https://www.googleapis.com/calendar/v3";
export const GOOGLE_CALENDAR_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events.owned",
];

export function googleCalendarRedirectUri(): string {
  const value = requiredEnv("GOOGLE_CALENDAR_REDIRECT_URI");
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new IntegrationError(500, "GOOGLE_REDIRECT_URI_INVALID");
  }
  return value;
}

export function googleCalendarAuthorizationUrl(state: string): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: requiredEnv("GOOGLE_CALENDAR_CLIENT_ID"),
    redirect_uri: googleCalendarRedirectUri(),
    response_type: "code",
    scope: GOOGLE_CALENDAR_SCOPES.join(" "),
    access_type: "offline",
    prompt: "select_account consent",
    include_granted_scopes: "true",
    state,
  }).toString();
  return url.toString();
}

export type GoogleTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type: string;
};

export async function exchangeGoogleCode(
  code: string,
): Promise<GoogleTokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: requiredEnv("GOOGLE_CALENDAR_CLIENT_ID"),
      client_secret: requiredEnv("GOOGLE_CALENDAR_CLIENT_SECRET"),
      redirect_uri: googleCalendarRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  const body = await response.json().catch(() => null) as
    | GoogleTokenResponse
    | null;
  if (
    !response.ok || !body?.access_token ||
    !Number.isSafeInteger(body.expires_in)
  ) {
    throw new IntegrationError(502, "GOOGLE_TOKEN_EXCHANGE_FAILED", true);
  }
  return body;
}

export async function getGoogleAccountEmail(
  accessToken: string,
): Promise<string> {
  const response = await fetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  const body = await response.json().catch(() => null) as {
    email?: string;
    email_verified?: boolean;
  } | null;
  if (!response.ok || !body?.email || body.email_verified !== true) {
    throw new IntegrationError(502, "GOOGLE_ACCOUNT_LOOKUP_FAILED", true);
  }
  return body.email;
}

export async function refreshGoogleAccessToken(
  refreshToken: string,
): Promise<GoogleTokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requiredEnv("GOOGLE_CALENDAR_CLIENT_ID"),
      client_secret: requiredEnv("GOOGLE_CALENDAR_CLIENT_SECRET"),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const body = await response.json().catch(() => null) as
    | GoogleTokenResponse
    | null;
  if (
    !response.ok || !body?.access_token ||
    !Number.isSafeInteger(body.expires_in)
  ) {
    throw new IntegrationError(
      response.status === 400 ? 401 : 502,
      "GOOGLE_TOKEN_REFRESH_FAILED",
      true,
    );
  }
  return body;
}

export function googleCalendarApiUrl(
  calendarId: string,
  eventId?: string,
): string {
  const encodedCalendarId = encodeURIComponent(calendarId);
  return `${GOOGLE_API}/calendars/${encodedCalendarId}/events${
    eventId ? `/${encodeURIComponent(eventId)}` : ""
  }`;
}

export function deterministicGoogleEventId(appointmentId: string): string {
  return `lb${appointmentId.replaceAll("-", "").toLowerCase()}`;
}

export async function googleCalendarRequest(
  accessToken: string,
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: Record<string, unknown>,
): Promise<Response> {
  return await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
