import { appOrigin, functionUrl } from "../_shared/env.ts";
import { endpoint, json, preflight, readJson } from "../_shared/http.ts";
import {
  mercadoPagoAccessToken,
  type MercadoPagoPreference,
  mercadoPagoRequest,
} from "../_shared/mercado-pago.ts";
import {
  IntegrationError,
  requireIdempotencyKey,
} from "../_shared/security.ts";
import { requireUser, rpc } from "../_shared/supabase.ts";

type RequestBody = { paymentOrderId?: unknown };
type CheckoutContext = {
  attempt_id: string;
  created: boolean;
  status: string;
  fingerprint: string;
  existing_preference_id: string | null;
  organization_id: string;
  payment_order_id: string;
  appointment_id: string;
  amount_cents: number;
  currency: string;
  description: string;
  payer_email: string | null;
  external_reference: string;
  access_token: string;
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
    const paymentOrderId = typeof body.paymentOrderId === "string"
      ? body.paymentOrderId
      : "";
    if (!uuidPattern.test(paymentOrderId)) {
      throw new IntegrationError(400, "INVALID_PAYMENT_ORDER_ID");
    }

    const idempotencyKey = requireIdempotencyKey(request);
    const context = await rpc<CheckoutContext | null>(
      "begin_mercado_pago_checkout",
      {
        p_payment_order_id: paymentOrderId,
        p_user_id: user.id,
        p_idempotency_key: idempotencyKey,
      },
    );
    if (context?.status === "CHECKOUT_IN_PROGRESS" && !context.access_token) {
      throw new IntegrationError(409, "CHECKOUT_IN_PROGRESS");
    }
    if (!context) throw new IntegrationError(404, "PAYMENT_ORDER_NOT_FOUND");
    if (
      !context.attempt_id ||
      !context.fingerprint ||
      !Number.isSafeInteger(context.amount_cents) ||
      context.amount_cents < 1 ||
      context.currency !== "BRL" ||
      !context.access_token
    ) {
      throw new IntegrationError(409, "PAYMENT_ORDER_NOT_PAYABLE");
    }
    const accessToken = await mercadoPagoAccessToken(context.organization_id);

    if (context.existing_preference_id) {
      const existingPreference = await mercadoPagoRequest<
        MercadoPagoPreference
      >(
        `/checkout/preferences/${
          encodeURIComponent(context.existing_preference_id)
        }`,
        accessToken,
      );
      if (
        existingPreference.id !== context.existing_preference_id ||
        !existingPreference.init_point
      ) {
        throw new IntegrationError(502, "INVALID_PROVIDER_RESPONSE", true);
      }
      return json(request, {
        checkoutUrl: existingPreference.init_point,
        preferenceId: existingPreference.id,
      });
    }
    if (context.status !== "RESERVED") {
      throw new IntegrationError(409, "CHECKOUT_IN_PROGRESS");
    }

    const baseUrl = appOrigin();
    const preference = await mercadoPagoRequest<MercadoPagoPreference>(
      "/checkout/preferences",
      accessToken,
      {
        method: "POST",
        body: JSON.stringify({
          items: [{
            id: context.payment_order_id,
            title: context.description.slice(0, 127),
            quantity: 1,
            currency_id: "BRL",
            unit_price: context.amount_cents / 100,
          }],
          ...(context.payer_email
            ? { payer: { email: context.payer_email } }
            : {}),
          external_reference: context.external_reference,
          metadata: {
            organization_id: context.organization_id,
            appointment_id: context.appointment_id,
            payment_order_id: context.payment_order_id,
          },
          back_urls: {
            success:
              `${baseUrl}/cliente/reservas?appointment_id=${context.appointment_id}&payment=approved`,
            pending:
              `${baseUrl}/cliente/reservas?appointment_id=${context.appointment_id}&payment=pending`,
            failure:
              `${baseUrl}/cliente/reservas?appointment_id=${context.appointment_id}&payment=failed`,
          },
          auto_return: "approved",
          notification_url: functionUrl("mercado-pago-webhook"),
        }),
      },
      context.fingerprint,
    );

    if (!preference.id || !preference.init_point) {
      throw new IntegrationError(502, "INVALID_PROVIDER_RESPONSE", true);
    }

    await rpc("complete_mercado_pago_checkout", {
      p_attempt_id: context.attempt_id,
      p_preference_id: preference.id,
      p_checkout_url: preference.init_point,
      p_user_id: user.id,
    });

    return json(
      request,
      { checkoutUrl: preference.init_point, preferenceId: preference.id },
      201,
    );
  });
});
