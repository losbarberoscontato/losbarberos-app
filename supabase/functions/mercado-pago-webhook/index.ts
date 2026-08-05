import { requiredEnv } from "../_shared/env.ts";
import { endpoint, json, readJson } from "../_shared/http.ts";
import {
  mercadoPagoAccessToken,
  type MercadoPagoPayment,
  mercadoPagoRequest,
} from "../_shared/mercado-pago.ts";
import {
  IntegrationError,
  verifyMercadoPagoSignature,
} from "../_shared/security.ts";
import { rpc } from "../_shared/supabase.ts";

type WebhookBody = {
  id?: string | number;
  type?: string;
  action?: string;
  user_id?: string | number;
  live_mode?: boolean;
  data?: { id?: string | number };
};

type MerchantContext = {
  organization_id: string;
  external_account_id: string;
  access_token: string;
};

type ProcessingResult = {
  duplicate?: boolean;
  applied?: boolean;
  refund_required?: boolean;
};

const providerIdPattern = /^[A-Za-z0-9_-]{1,128}$/u;

Deno.serve((request) =>
  endpoint(request, async () => {
    if (request.method !== "POST") {
      throw new IntegrationError(405, "METHOD_NOT_ALLOWED");
    }

    const url = new URL(request.url);
    const queryDataId = url.searchParams.get("data.id") ??
      url.searchParams.get("data_id");
    const validSignature = await verifyMercadoPagoSignature({
      header: request.headers.get("x-signature"),
      requestId: request.headers.get("x-request-id"),
      dataId: queryDataId,
      secret: requiredEnv("MERCADO_PAGO_WEBHOOK_SECRET"),
    });
    if (!validSignature) {
      throw new IntegrationError(401, "INVALID_SIGNATURE");
    }

    const payload = await readJson<WebhookBody>(request, 262_144);
    const dataId = String(queryDataId ?? payload.data?.id ?? "");
    const externalAccountId = String(payload.user_id ?? "");
    if (
      !providerIdPattern.test(dataId) ||
      !providerIdPattern.test(externalAccountId)
    ) {
      throw new IntegrationError(400, "INVALID_WEBHOOK_PAYLOAD");
    }

    const merchant = await rpc<MerchantContext | null>(
      "resolve_mercado_pago_webhook_account",
      {
        p_external_account_id: externalAccountId,
      },
    );
    if (!merchant?.access_token) {
      throw new IntegrationError(404, "MERCHANT_NOT_FOUND");
    }
    if (payload.type !== "payment") {
      await rpc("record_provider_webhook", {
        p_provider: "MERCADO_PAGO",
        p_event_id: String(payload.id ?? `${payload.type}:${dataId}`),
        p_event_type: payload.type ?? "unknown",
        p_organization_id: merchant.organization_id,
        p_payload: { action: payload.action, data_id: dataId },
      });
      return json(request, { received: true, applied: false });
    }

    const accessToken = await mercadoPagoAccessToken(merchant.organization_id);

    const payment = await mercadoPagoRequest<MercadoPagoPayment>(
      `/v1/payments/${encodeURIComponent(dataId)}`,
      accessToken,
    );
    if (String(payment.collector_id) !== merchant.external_account_id) {
      throw new IntegrationError(403, "MERCHANT_MISMATCH");
    }

    const status = (() => {
      switch (payment.status) {
        case "approved":
          return "CAPTURED";
        case "refunded":
          return "REFUNDED";
        case "charged_back":
          return "CHARGEBACK";
        case "cancelled":
          return "CANCELED";
        case "rejected":
          return "FAILED";
        default:
          return "PENDING";
      }
    })();

    const eventId = String(
      payload.id ?? `payment:${payment.id}:${payload.action ?? "updated"}`,
    );
    const result = await rpc<ProcessingResult>(
      "process_mercado_pago_payment_webhook",
      {
        p_event_id: eventId,
        p_event_type: payload.action ?? "payment.updated",
        p_organization_id: merchant.organization_id,
        p_payment_id: String(payment.id),
        p_external_reference: payment.external_reference ?? null,
        p_status: status,
        p_status_detail: payment.status_detail ?? null,
        p_amount_cents: Math.round(payment.transaction_amount * 100),
        p_currency: payment.currency_id,
        p_approved_at: payment.date_approved ?? null,
        p_payload: {
          metadata: payment.metadata ?? {},
          refunds: payment.refunds ?? [],
        },
      },
    );

    return json(request, {
      received: true,
      duplicate: result?.duplicate === true,
      applied: result?.applied !== false,
      refundQueued: result?.refund_required === true,
    });
  })
);
