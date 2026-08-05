import { appOrigin, requiredEnv } from "../_shared/env.ts";
import { endpoint, json, preflight, readJson } from "../_shared/http.ts";
import {
  IntegrationError,
  requireIdempotencyKey,
  safeReturnPath,
  scopedIdempotencyKey,
} from "../_shared/security.ts";
import {
  requireOrganizationOwner,
  requireUser,
  rpc,
} from "../_shared/supabase.ts";
import { stripeClient } from "../_shared/stripe.ts";

type RequestBody = {
  organizationId?: unknown;
  returnPath?: unknown;
};

type CheckoutContext = {
  attempt_id: string;
  created: boolean;
  status: string;
  existing_session_id: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  trial_consumed_at: string | null;
};

const organizationIdPattern =
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
    if (!organizationIdPattern.test(organizationId)) {
      throw new IntegrationError(400, "INVALID_ORGANIZATION_ID");
    }

    await requireOrganizationOwner(organizationId, user.id);
    const idempotencyKey = requireIdempotencyKey(request);
    const priceId = requiredEnv("STRIPE_PRICE_ID");
    const context = await rpc<CheckoutContext | null>(
      "reserve_stripe_checkout_attempt",
      {
        p_organization_id: organizationId,
        p_requested_by_user_id: user.id,
        p_idempotency_key: idempotencyKey,
        p_price_id: priceId,
      },
    );
    if (
      context?.stripe_subscription_id &&
      ["TRIALING", "ACTIVE", "GRACE", "BLOCKED"].includes(
        context.subscription_status ?? "",
      )
    ) {
      throw new IntegrationError(409, "SUBSCRIPTION_ALREADY_EXISTS");
    }
    if (!context?.attempt_id) {
      throw new IntegrationError(409, "CHECKOUT_NOT_AVAILABLE");
    }

    const returnPath = safeReturnPath(
      body.returnPath,
      "/gestor/configuracoes",
    );
    const baseUrl = appOrigin();
    const separator = returnPath.includes("?") ? "&" : "?";
    const stripe = stripeClient();

    if (context.existing_session_id) {
      const existingSession = await stripe.checkout.sessions.retrieve(
        context.existing_session_id,
      );
      if (!existingSession.url) {
        throw new IntegrationError(502, "CHECKOUT_URL_MISSING", true);
      }
      return json(request, {
        checkoutUrl: existingSession.url,
        sessionId: existingSession.id,
      });
    }
    if (context.status !== "RESERVED") {
      throw new IntegrationError(409, "CHECKOUT_IN_PROGRESS");
    }

    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        client_reference_id: organizationId,
        ...(context?.stripe_customer_id
          ? { customer: context.stripe_customer_id }
          : user.email
          ? { customer_email: user.email }
          : {}),
        subscription_data: {
          ...(context?.trial_consumed_at ? {} : { trial_period_days: 14 }),
          metadata: { organization_id: organizationId },
          ...(context?.trial_consumed_at ? {} : {
            trial_settings: {
              end_behavior: { missing_payment_method: "cancel" as const },
            },
          }),
        },
        metadata: {
          organization_id: organizationId,
          requested_by_user_id: user.id,
        },
        success_url:
          `${baseUrl}${returnPath}${separator}checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}${returnPath}${separator}checkout=canceled`,
      },
      {
        idempotencyKey: await scopedIdempotencyKey(
          "subscription-checkout",
          organizationId,
          idempotencyKey,
        ),
      },
    );

    if (!session.url) {
      throw new IntegrationError(502, "CHECKOUT_URL_MISSING", true);
    }

    await rpc("complete_stripe_checkout_attempt", {
      p_attempt_id: context.attempt_id,
      p_checkout_session_id: session.id,
      p_requested_by_user_id: user.id,
    });

    return json(
      request,
      { checkoutUrl: session.url, sessionId: session.id },
      201,
    );
  });
});
