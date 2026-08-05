import { bytesToBase64Url, sha256Hex } from "./crypto";

export const DEFAULT_STATE_TTL_SECONDS = 10 * 60;
export const DEFAULT_ACTION_TTL_SECONDS = 15 * 60;

export function createOpaqueToken(byteLength = 32): string {
  if (!Number.isSafeInteger(byteLength) || byteLength < 16 || byteLength > 128) {
    throw new RangeError("Token length must be between 16 and 128 bytes");
  }

  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export function hashOpaqueToken(token: string): Promise<string> {
  if (!token || token.length > 512) {
    throw new TypeError("Invalid opaque token");
  }

  return sha256Hex(token);
}

export function expiresAt(
  now: Date = new Date(),
  ttlSeconds = DEFAULT_STATE_TTL_SECONDS,
): Date {
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 86_400) {
    throw new RangeError("TTL must be between 1 and 86400 seconds");
  }

  return new Date(now.getTime() + ttlSeconds * 1_000);
}

export function normalizeSafeReturnPath(
  value: unknown,
  fallback = "/app/integracoes",
): string {
  if (typeof value !== "string" || !value.startsWith("/")) {
    return fallback;
  }

  if (value.startsWith("//") || value.includes("\\") || /[\r\n]/u.test(value)) {
    return fallback;
  }

  try {
    const parsed = new URL(value, "https://losbarberos.invalid");
    return parsed.origin === "https://losbarberos.invalid"
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : fallback;
  } catch {
    return fallback;
  }
}
