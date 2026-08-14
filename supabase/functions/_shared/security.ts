// @ts-ignore Deno Edge Functions require explicit TypeScript extensions.
import {
  createOpaqueToken,
  hmacSha256Hex,
  sha256Hex,
  timingSafeEqual,
} from "./crypto.ts";

export { createOpaqueToken, sha256Hex };

export async function verifyMercadoPagoSignature(input: {
  header: string | null;
  requestId: string | null;
  dataId: string | null;
  secret: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): Promise<boolean> {
  if (!input.header) return false;

  const parts = new Map(
    input.header.split(",").map((part) => {
      const [key, ...value] = part.trim().split("=");
      return [key, value.join("=")];
    }),
  );
  const timestamp = parts.get("ts");
  const provided = parts.get("v1")?.toLowerCase();
  const timestampNumber = Number(timestamp);

  if (!timestamp || !provided || !Number.isSafeInteger(timestampNumber)) {
    return false;
  }

  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1_000);
  const toleranceSeconds = input.toleranceSeconds ?? 300;
  if (Math.abs(nowSeconds - timestampNumber) > toleranceSeconds) return false;

  let manifest = "";
  if (input.dataId?.trim()) {
    manifest += `id:${input.dataId.trim().toLowerCase()};`;
  }
  if (input.requestId?.trim()) {
    manifest += `request-id:${input.requestId.trim()};`;
  }
  manifest += `ts:${timestamp};`;

  const expected = await hmacSha256Hex(input.secret, manifest);
  return timingSafeEqual(provided, expected);
}

export async function verifyMetaSignature(
  rawBody: string,
  header: string | null,
  appSecret: string,
): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const expected = await hmacSha256Hex(appSecret, rawBody);
  return timingSafeEqual(header.slice(7).toLowerCase(), expected);
}

export function verifySharedSecretHeader(
  header: string | null,
  secret: string,
): boolean {
  return timingSafeEqual(header?.trim() ?? "", secret);
}

export function safeReturnPath(value: unknown, fallback: string): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\r\n]/u.test(value)
  ) {
    return fallback;
  }

  try {
    const url = new URL(value, "https://losbarberos.invalid");
    return url.origin === "https://losbarberos.invalid"
      ? `${url.pathname}${url.search}${url.hash}`
      : fallback;
  } catch {
    return fallback;
  }
}

export function requireIdempotencyKey(request: Request): string {
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key || key.length < 8 || key.length > 255 || /[\r\n]/u.test(key)) {
    throw new IntegrationError(400, "INVALID_IDEMPOTENCY_KEY");
  }
  return key;
}

export async function scopedIdempotencyKey(
  scope: string,
  organizationId: string,
  rawKey: string,
): Promise<string> {
  const digest = await sha256Hex(`${scope}\0${organizationId}\0${rawKey}`);
  // UUID-shaped deterministic key stays inside conservative provider limits.
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${
    digest.slice(12, 16)
  }-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
}

export class IntegrationError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly retryable = false,
    public readonly retryAfterSeconds?: number,
  ) {
    super(code);
    this.name = "IntegrationError";
  }
}
