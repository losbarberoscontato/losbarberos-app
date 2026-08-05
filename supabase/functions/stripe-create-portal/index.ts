import { appOrigin } from "../_shared/env.ts";
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

type RequestBody = { organizationId?: unknown; returnPath?: unknown };
type PortalContext = { stripe_customer_id: string | null };

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
    const context = await rpc<PortalContext | null>(
      "get_stripe_checkout_context",
      {
        p_organization_id: organizationId,
      },
    );
    if (!context?.stripe_customer_id) {
      throw new IntegrationError(409, "STRIPE_CUSTOMER_MISSING");
    }

    const idempotencyKey = requireIdempotencyKey(request);
    const returnPath = safeReturnPath(
      body.returnPath,
      "/regularizacao",
    );
    const session = await stripeClient().billingPortal.sessions.create(
      {
        customer: context.stripe_customer_id,
        return_url: `${appOrigin()}${returnPath}`,
      },
      {
        idempotencyKey: await scopedIdempotencyKey(
          "billing-portal",
          organizationId,
          idempotencyKey,
        ),
      },
    );

    await rpc("record_billing_portal_session", {
      p_organization_id: organizationId,
      p_portal_session_id: session.id,
      p_requested_by_user_id: user.id,
    });

    return json(request, { portalUrl: session.url }, 201);
  });
});
