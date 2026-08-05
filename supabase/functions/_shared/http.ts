import { appOrigin } from "./env.ts";
import { IntegrationError } from "./security.ts";

const commonHeaders = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
};

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || origin !== appOrigin()) return {};

  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers":
      "authorization, content-type, idempotency-key, x-client-info",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    vary: "Origin",
  };
}

export function preflight(request: Request): Response | null {
  if (request.method !== "OPTIONS") return null;
  const origin = request.headers.get("origin");
  if (origin !== appOrigin()) return new Response(null, { status: 403 });

  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export function json(
  request: Request,
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...commonHeaders, ...corsHeaders(request), ...extraHeaders },
  });
}

export function redirect(location: string, status = 303): Response {
  return new Response(null, {
    status,
    headers: {
      "cache-control": "no-store",
      location,
      "referrer-policy": "no-referrer",
    },
  });
}

export async function readJson<T>(
  request: Request,
  maxBytes = 65_536,
): Promise<T> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > maxBytes) {
    throw new IntegrationError(413, "PAYLOAD_TOO_LARGE");
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > maxBytes) {
    throw new IntegrationError(413, "PAYLOAD_TOO_LARGE");
  }

  try {
    return JSON.parse(rawBody) as T;
  } catch {
    throw new IntegrationError(400, "INVALID_JSON");
  }
}

export async function endpoint(
  request: Request,
  handler: () => Promise<Response>,
): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof IntegrationError) {
      const retryHeaders: Record<string, string> =
        error.retryAfterSeconds === undefined
          ? {}
          : { "retry-after": String(error.retryAfterSeconds) };
      return json(
        request,
        {
          error: error.code,
          retryable: error.retryable,
          ...(error.retryAfterSeconds === undefined
            ? {}
            : { retryAfterSeconds: error.retryAfterSeconds }),
        },
        error.status,
        retryHeaders,
      );
    }

    console.error("integration_error", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return json(request, { error: "INTERNAL_ERROR", retryable: true }, 500);
  }
}
