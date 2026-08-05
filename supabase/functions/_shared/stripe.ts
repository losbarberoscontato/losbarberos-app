import Stripe from "npm:stripe@22.4.0";

import { requiredEnv } from "./env.ts";

export const STRIPE_API_VERSION = "2026-07-29.dahlia" as const;

export function stripeClient(): Stripe {
  return new Stripe(requiredEnv("STRIPE_RESTRICTED_KEY"), {
    apiVersion: STRIPE_API_VERSION,
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 2,
    telemetry: false,
  });
}

export function stripeCryptoProvider() {
  return Stripe.createSubtleCryptoProvider();
}
