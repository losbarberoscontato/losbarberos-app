import { hmacSha256Hex, timingSafeEqual } from "./crypto";

export type SignatureVerification =
  | { valid: true; timestamp?: number }
  | {
      valid: false;
      reason: "MALFORMED" | "MISMATCH" | "STALE";
      timestamp?: number;
    };

type TimedSignatureOptions = {
  nowSeconds?: number;
  toleranceSeconds?: number;
};

function withinTolerance(
  timestamp: number,
  nowSeconds: number,
  toleranceSeconds: number,
): boolean {
  return Math.abs(nowSeconds - timestamp) <= toleranceSeconds;
}

export async function verifyStripeWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  options: TimedSignatureOptions = {},
): Promise<SignatureVerification> {
  if (!signatureHeader) {
    return { valid: false, reason: "MALFORMED" };
  }

  const parts = signatureHeader.split(",").map((part) => part.trim());
  const timestampPart = parts.find((part) => part.startsWith("t="));
  const signatures = parts
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3));
  const timestamp = Number(timestampPart?.slice(2));

  if (!Number.isSafeInteger(timestamp) || signatures.length === 0) {
    return { valid: false, reason: "MALFORMED" };
  }

  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1_000);
  const toleranceSeconds = options.toleranceSeconds ?? 300;

  if (!withinTolerance(timestamp, nowSeconds, toleranceSeconds)) {
    return { valid: false, reason: "STALE", timestamp };
  }

  const expected = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
  const matches = signatures.some((signature) =>
    timingSafeEqual(signature.toLowerCase(), expected),
  );

  return matches
    ? { valid: true, timestamp }
    : { valid: false, reason: "MISMATCH", timestamp };
}

export function buildMercadoPagoSignatureManifest(input: {
  dataId?: string | null;
  requestId?: string | null;
  timestamp: string;
}): string {
  const segments: string[] = [];
  const dataId = input.dataId?.trim().toLowerCase();
  const requestId = input.requestId?.trim();

  if (dataId) {
    segments.push(`id:${dataId};`);
  }

  if (requestId) {
    segments.push(`request-id:${requestId};`);
  }

  segments.push(`ts:${input.timestamp};`);
  return segments.join("");
}

export async function verifyMercadoPagoWebhookSignature(
  signatureHeader: string | null,
  requestId: string | null,
  dataId: string | null,
  secret: string,
  options: TimedSignatureOptions = {},
): Promise<SignatureVerification> {
  if (!signatureHeader) {
    return { valid: false, reason: "MALFORMED" };
  }

  const values = new Map(
    signatureHeader.split(",").map((part) => {
      const [key, ...value] = part.trim().split("=");
      return [key, value.join("=")];
    }),
  );
  const timestampValue = values.get("ts");
  const provided = values.get("v1");
  const timestamp = Number(timestampValue);

  if (!timestampValue || !provided || !Number.isSafeInteger(timestamp)) {
    return { valid: false, reason: "MALFORMED" };
  }

  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1_000);
  const toleranceSeconds = options.toleranceSeconds ?? 300;

  if (!withinTolerance(timestamp, nowSeconds, toleranceSeconds)) {
    return { valid: false, reason: "STALE", timestamp };
  }

  const manifest = buildMercadoPagoSignatureManifest({
    dataId,
    requestId,
    timestamp: timestampValue,
  });
  const expected = await hmacSha256Hex(secret, manifest);

  return timingSafeEqual(provided.toLowerCase(), expected)
    ? { valid: true, timestamp }
    : { valid: false, reason: "MISMATCH", timestamp };
}

export async function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): Promise<SignatureVerification> {
  if (!signatureHeader?.startsWith("sha256=")) {
    return { valid: false, reason: "MALFORMED" };
  }

  const provided = signatureHeader.slice("sha256=".length).toLowerCase();
  const expected = await hmacSha256Hex(appSecret, rawBody);

  return timingSafeEqual(provided, expected)
    ? { valid: true }
    : { valid: false, reason: "MISMATCH" };
}
