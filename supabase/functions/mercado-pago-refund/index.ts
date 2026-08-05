import { endpoint, json, preflight, readJson } from "../_shared/http.ts";
import {
  executeMercadoPagoRefundJob,
  type MercadoPagoRefundJob,
} from "../_shared/mercado-pago-refunds.ts";
import {
  IntegrationError,
  requireIdempotencyKey,
  scopedIdempotencyKey,
} from "../_shared/security.ts";
import {
  requireOrganizationOwner,
  requireUser,
  rpc,
} from "../_shared/supabase.ts";

type RequestBody = {
  organizationId?: unknown;
  paymentOrderId?: unknown;
  amountCents?: unknown;
  reason?: unknown;
};

type RefundReservation = MercadoPagoRefundJob & {
  created: boolean;
  status: string;
  external_refund_id?: string | null;
  provider_payment_id: string;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

Deno.serve((request) => {
  const options = preflight(request);
  if (options) return options;

  return endpoint(request, async () => {
    if (request.method !== "POST") {
      throw new IntegrationError(405, "METHOD_NOT_ALLOWED");
    }

    const user = await requireUser(request);
    const body = await readJson<RequestBody>(request);
    const organizationId = typeof body.organizationId === "string"
      ? body.organizationId
      : "";
    const paymentOrderId = typeof body.paymentOrderId === "string"
      ? body.paymentOrderId
      : "";
    if (
      !uuidPattern.test(organizationId) || !uuidPattern.test(paymentOrderId)
    ) {
      throw new IntegrationError(400, "INVALID_REQUEST");
    }
    await requireOrganizationOwner(organizationId, user.id);

    const requestedAmount = body.amountCents === undefined
      ? null
      : body.amountCents;
    if (
      requestedAmount !== null &&
      (!Number.isSafeInteger(requestedAmount) || Number(requestedAmount) < 1)
    ) {
      throw new IntegrationError(400, "INVALID_REFUND_AMOUNT");
    }

    const idempotencyKey = await scopedIdempotencyKey(
      "mercado-pago-refund",
      organizationId,
      requireIdempotencyKey(request),
    );
    const reservation = await rpc<RefundReservation | null>(
      "begin_mercado_pago_refund",
      {
        p_organization_id: organizationId,
        p_payment_order_id: paymentOrderId,
        p_amount_cents: requestedAmount,
        p_reason: typeof body.reason === "string"
          ? body.reason.slice(0, 500)
          : "MANUAL_REFUND",
        p_user_id: user.id,
        p_idempotency_key: idempotencyKey,
      },
    );
    if (!reservation) throw new IntegrationError(404, "PAYMENT_NOT_FOUND");
    if (reservation.status === "SUCCEEDED" && reservation.external_refund_id) {
      return json(request, {
        refundId: reservation.external_refund_id,
        status: "approved",
      }, 200);
    }
    if (!reservation.access_token) {
      throw new IntegrationError(404, "PAYMENT_NOT_FOUND");
    }
    if (reservation.status !== "PROCESSING") {
      throw new IntegrationError(409, "REFUND_ALREADY_IN_PROGRESS");
    }

    const refund = await executeMercadoPagoRefundJob({
      ...reservation,
      organization_id: organizationId,
    }, null);

    return json(request, {
      refundId: refund.refundId,
      status: refund.status,
    }, 201);
  });
});
