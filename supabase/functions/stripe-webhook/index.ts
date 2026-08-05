import type Stripe from "npm:stripe@22.4.0";

import { requiredEnv } from "../_shared/env.ts";
import { endpoint, json } from "../_shared/http.ts";
import { IntegrationError } from "../_shared/security.ts";
import { rpc } from "../_shared/supabase.ts";
import { stripeClient, stripeCryptoProvider } from "../_shared/stripe.ts";

type ProcessResult = {
  duplicate?: boolean;
  applied?: boolean;
  retryable?: boolean;
  reason?: string;
  cancel_unexpected_subscription_id?: string | null;
} | null;

const allowedEvents = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
]);

function mappedStatus(event: Stripe.Event): string | null {
  if (event.type === "invoice.payment_failed") return "GRACE";
  if (event.type === "invoice.paid") return "ACTIVE";

  if (event.type.startsWith("customer.subscription.")) {
    const status = (event.data.object as Stripe.Subscription).status;
    switch (status) {
      case "trialing":
        return "TRIALING";
      case "active":
        return "ACTIVE";
      case "past_due":
      case "unpaid":
        return "GRACE";
      case "paused":
        return "BLOCKED";
      case "canceled":
        return "CANCELED_RETENTION";
      default:
        return "PROVISIONING";
    }
  }

  return null;
}

function sanitizedObject(event: Stripe.Event): Record<string, unknown> {
  const object = event.data.object as unknown as Record<string, unknown>;

  if (event.type === "checkout.session.completed") {
    return {
      id: object.id,
      object: object.object,
      client_reference_id: object.client_reference_id,
      customer: object.customer,
      subscription: object.subscription,
      status: object.status,
      payment_status: object.payment_status,
      metadata: object.metadata,
    };
  }

  if (event.type.startsWith("customer.subscription.")) {
    return {
      id: object.id,
      object: object.object,
      customer: object.customer,
      status: object.status,
      metadata: object.metadata,
      trial_start: object.trial_start,
      trial_end: object.trial_end,
      current_period_start: object.current_period_start,
      current_period_end: object.current_period_end,
      cancel_at: object.cancel_at,
      canceled_at: object.canceled_at,
      items: object.items,
    };
  }

  if (event.type.startsWith("invoice.")) {
    return {
      id: object.id,
      object: object.object,
      customer: object.customer,
      status: object.status,
      paid: object.paid,
      attempt_count: object.attempt_count,
      billing_reason: object.billing_reason,
      parent: object.parent,
      subscription: object.subscription,
    };
  }

  return {};
}

Deno.serve((request) =>
  endpoint(request, async () => {
    if (request.method !== "POST") {
      throw new IntegrationError(405, "METHOD_NOT_ALLOWED");
    }

    const signature = request.headers.get("stripe-signature");
    if (!signature) {
      throw new IntegrationError(401, "INVALID_SIGNATURE");
    }

    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 1_048_576) {
      throw new IntegrationError(413, "PAYLOAD_TOO_LARGE");
    }

    let event: Stripe.Event;
    try {
      event = await stripeClient().webhooks.constructEventAsync(
        rawBody,
        signature,
        requiredEnv("STRIPE_WEBHOOK_SECRET"),
        300,
        stripeCryptoProvider(),
      );
    } catch {
      throw new IntegrationError(401, "INVALID_SIGNATURE");
    }

    if (!allowedEvents.has(event.type)) {
      return json(request, { received: true, applied: false });
    }

    const status = mappedStatus(event);
    const result = await rpc<ProcessResult>("process_stripe_billing_webhook", {
      p_event_id: event.id,
      p_event_type: event.type,
      p_event_created_at: new Date(event.created * 1_000).toISOString(),
      p_livemode: event.livemode,
      p_mapped_status: status,
      p_grace_until: status === "GRACE"
        ? new Date((event.created + 7 * 86_400) * 1_000).toISOString()
        : null,
      p_payload: sanitizedObject(event),
    });

    if (result?.retryable === true) {
      throw new IntegrationError(
        503,
        result.reason ?? "STRIPE_WEBHOOK_DEPENDENCY_PENDING",
        true,
        60,
      );
    }

    const unexpectedSubscriptionId = result?.cancel_unexpected_subscription_id;
    if (unexpectedSubscriptionId) {
      if (!/^sub_[A-Za-z0-9]+$/u.test(unexpectedSubscriptionId)) {
        throw new IntegrationError(
          500,
          "INVALID_UNEXPECTED_STRIPE_SUBSCRIPTION_ID",
          true,
        );
      }

      try {
        await stripeClient().subscriptions.cancel(unexpectedSubscriptionId);
      } catch (error) {
        const stripeCode = error && typeof error === "object" && "code" in error
          ? String(error.code)
          : null;
        if (stripeCode !== "resource_missing") throw error;
      }

      await rpc<boolean>(
        "complete_unexpected_stripe_subscription_cancellation",
        {
          p_event_id: event.id,
          p_subscription_id: unexpectedSubscriptionId,
        },
      );
    }

    return json(request, {
      received: true,
      duplicate: result?.duplicate === true,
      applied: result?.applied !== false,
    });
  })
);
