import { endpoint, json, preflight, readJson } from "../_shared/http.ts";
import { requiredEnv } from "../_shared/env.ts";
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
import { stripeClient } from "../_shared/stripe.ts";

type RequestBody = {
  organizationId?: unknown;
  action?: unknown;
  contractVersion?: unknown;
};
type BillingContext = {
  already_done?: boolean;
  enabled?: boolean;
  operation_id: string;
  idempotency_key: string;
  subscription_id: string;
  base_price_id: string;
  price_id: string;
  existing_item_id: string | null;
  charge_starts_at: string | null;
  monthly_price_cents: number;
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
    if (
      !uuidPattern.test(organizationId) ||
      (body.action !== "ENABLE" && body.action !== "DISABLE")
    ) {
      throw new IntegrationError(400, "INVALID_KANBAN_CHANGE");
    }
    await requireOrganizationOwner(organizationId, user.id);
    const key = requireIdempotencyKey(request);
    const configuredKey = requiredEnv("STRIPE_RESTRICTED_KEY");
    if (!/^(rk|sk)_(test|live)_/u.test(configuredKey)) {
      throw new IntegrationError(500, "STRIPE_MODE_UNRESOLVED");
    }
    const liveMode = /^(rk|sk)_live_/u.test(configuredKey);
    const context = await rpc<BillingContext>("begin_kanban_billing_change", {
      p_organization_id: organizationId,
      p_action: body.action,
      p_idempotency_key: key,
      p_actor_user_id: user.id,
      p_livemode: liveMode,
      p_contract_version: typeof body.contractVersion === "string"
        ? body.contractVersion
        : null,
    });
    if (context.already_done) {
      return json(request, { enabled: context.enabled, alreadyDone: true });
    }

    const stripe = stripeClient();
    const subscription = await stripe.subscriptions.retrieve(
      context.subscription_id,
    );
    if (subscription.livemode !== liveMode) {
      throw new IntegrationError(409, "STRIPE_MODE_MISMATCH");
    }
    if (context.price_id === context.base_price_id) {
      throw new IntegrationError(409, "KANBAN_PRICE_EQUALS_BASE_PRICE");
    }
    if (body.action === "ENABLE") {
      const modulePrice = await stripe.prices.retrieve(context.price_id);
      if (
        !modulePrice.active ||
        modulePrice.unit_amount !== context.monthly_price_cents ||
        modulePrice.currency !== "brl" ||
        modulePrice.recurring?.interval !== "month" ||
        modulePrice.recurring?.interval_count !== 1
      ) {
        throw new IntegrationError(409, "KANBAN_PRICE_CONFIGURATION_MISMATCH");
      }
    }
    const items = subscription.items.data;
    const baseItem = items.find((item) =>
      item.price.id === context.base_price_id
    );
    if (!baseItem) {
      throw new IntegrationError(409, "STRIPE_BASE_PRICE_MISMATCH");
    }
    if (
      baseItem.price.currency !== "brl" ||
      baseItem.price.recurring?.interval !== "month" ||
      baseItem.price.recurring?.interval_count !== 1
    ) {
      throw new IntegrationError(409, "STRIPE_BASE_INTERVAL_MISMATCH");
    }
    const matching = items.filter((item) => item.price.id === context.price_id);
    if (matching.length > 1) {
      throw new IntegrationError(409, "DUPLICATE_KANBAN_ITEMS");
    }
    if (
      matching[0] &&
      (matching[0].metadata?.module_key !== "kanban" ||
        matching[0].metadata?.organization_id !== organizationId)
    ) {
      throw new IntegrationError(409, "KANBAN_ITEM_BINDING_MISMATCH");
    }
    let itemId: string | null = null;
    if (body.action === "ENABLE") {
      if (matching[0]) {
        itemId = matching[0].id;
      } else {
        const item = await stripe.subscriptionItems.create({
          subscription: context.subscription_id,
          price: context.price_id,
          quantity: 1,
          proration_behavior: "none",
          metadata: { module_key: "kanban", organization_id: organizationId },
        }, {
          idempotencyKey: await scopedIdempotencyKey(
            "kanban-enable",
            organizationId,
            context.idempotency_key,
          ),
        });
        itemId = item.id;
      }
    } else {
      const target = items.find((item) =>
        item.id === context.existing_item_id
      ) ?? matching[0];
      if (target) {
        if (target.price.id !== context.price_id) {
          throw new IntegrationError(409, "KANBAN_ITEM_PRICE_MISMATCH");
        }
        await stripe.subscriptionItems.del(target.id, {
          proration_behavior: "none",
        }, {
          idempotencyKey: await scopedIdempotencyKey(
            "kanban-disable",
            organizationId,
            context.idempotency_key,
          ),
        });
      }
    }
    await rpc("finish_kanban_billing_change", {
      p_operation_id: context.operation_id,
      p_stripe_subscription_item_id: itemId,
    });
    return json(request, {
      enabled: body.action === "ENABLE",
      chargeStartsAt: context.charge_starts_at,
      prorated: false,
    });
  });
});
