import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  buildMercadoPagoSignatureManifest,
  verifyMercadoPagoWebhookSignature,
  verifyMetaWebhookSignature,
  verifyStripeWebhookSignature,
} from "@/lib/integrations/signatures";

const hmac = (secret: string, value: string) =>
  createHmac("sha256", secret).update(value).digest("hex");

describe("Stripe webhook signature", () => {
  it("accepts a matching v1 signature inside tolerance", async () => {
    const payload = '{"id":"evt_123"}';
    const timestamp = 1_700_000_000;
    const secret = "whsec_test";
    const signature = hmac(secret, `${timestamp}.${payload}`);

    await expect(
      verifyStripeWebhookSignature(
        payload,
        `t=${timestamp},v1=${signature}`,
        secret,
        { nowSeconds: timestamp + 30 },
      ),
    ).resolves.toEqual({ valid: true, timestamp });
  });

  it("rejects replay outside five-minute tolerance", async () => {
    const timestamp = 1_700_000_000;
    const payload = "{}";
    const secret = "whsec_test";

    await expect(
      verifyStripeWebhookSignature(
        payload,
        `t=${timestamp},v1=${hmac(secret, `${timestamp}.${payload}`)}`,
        secret,
        { nowSeconds: timestamp + 301 },
      ),
    ).resolves.toEqual({ valid: false, reason: "STALE", timestamp });
  });

  it("rejects a tampered payload", async () => {
    const timestamp = 1_700_000_000;
    const secret = "whsec_test";

    const result = await verifyStripeWebhookSignature(
      '{"tampered":true}',
      `t=${timestamp},v1=${hmac(secret, `${timestamp}.{}`)}`,
      secret,
      { nowSeconds: timestamp },
    );

    expect(result).toMatchObject({ valid: false, reason: "MISMATCH" });
  });
});

describe("Mercado Pago webhook signature", () => {
  it("builds official manifest and lowercases alphanumeric data id", () => {
    expect(
      buildMercadoPagoSignatureManifest({
        dataId: "ABC123",
        requestId: "request-1",
        timestamp: "1700000000",
      }),
    ).toBe("id:abc123;request-id:request-1;ts:1700000000;");
  });

  it("accepts a valid signed request", async () => {
    const secret = "mp-secret";
    const timestamp = "1700000000";
    const manifest = `id:payment-1;request-id:req-1;ts:${timestamp};`;

    await expect(
      verifyMercadoPagoWebhookSignature(
        `ts=${timestamp},v1=${hmac(secret, manifest)}`,
        "req-1",
        "PAYMENT-1",
        secret,
        { nowSeconds: Number(timestamp) },
      ),
    ).resolves.toEqual({ valid: true, timestamp: Number(timestamp) });
  });
});

describe("Meta webhook signature", () => {
  it("requires sha256 HMAC over exact raw body", async () => {
    const rawBody = '{"object":"whatsapp_business_account"}';
    const secret = "meta-secret";

    await expect(
      verifyMetaWebhookSignature(
        rawBody,
        `sha256=${hmac(secret, rawBody)}`,
        secret,
      ),
    ).resolves.toEqual({ valid: true });

    await expect(
      verifyMetaWebhookSignature(
        `${rawBody} `,
        `sha256=${hmac(secret, rawBody)}`,
        secret,
      ),
    ).resolves.toMatchObject({ valid: false, reason: "MISMATCH" });
  });
});
