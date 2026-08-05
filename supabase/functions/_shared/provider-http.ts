// @ts-ignore Deno Edge Functions require explicit TypeScript extensions.
import { IntegrationError } from "./security.ts";

const retryableProviderStatuses = new Set([408, 423, 429]);

function retryAfterSeconds(
  value: string | null,
  nowMs = Date.now(),
): number | undefined {
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isInteger(seconds) && seconds >= 0) return seconds;

  const retryAtMs = Date.parse(value);
  if (!Number.isFinite(retryAtMs)) return undefined;
  return Math.max(0, Math.ceil((retryAtMs - nowMs) / 1_000));
}

export async function providerFetch<T>(
  url: string,
  init: RequestInit,
  timeoutMs = 10_000,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const raw = await response.text();
    let body: unknown = null;

    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = null;
      }
    }

    if (!response.ok) {
      const retryable = response.status >= 500 ||
        retryableProviderStatuses.has(response.status);
      console.error("provider_request_failed", {
        host: new URL(url).host,
        status: response.status,
        requestId: response.headers.get("request-id") ??
          response.headers.get("x-request-id"),
      });
      throw new IntegrationError(
        response.status >= 500 ? 502 : 422,
        "PROVIDER_REQUEST_FAILED",
        retryable,
        retryable
          ? retryAfterSeconds(response.headers.get("retry-after"))
          : undefined,
      );
    }

    return body as T;
  } catch (error) {
    if (error instanceof IntegrationError) throw error;
    throw new IntegrationError(504, "PROVIDER_TIMEOUT", true);
  } finally {
    clearTimeout(timeout);
  }
}
