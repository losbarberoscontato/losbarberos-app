import { describe, expect, it } from "vitest";

import {
  mapMercadoPagoPaymentStatus,
  mapStripeSubscriptionStatus,
  mapWhatsAppMessageStatus,
} from "@/lib/integrations/status";

describe("provider status mappings", () => {
  it("maps Stripe dunning states to grace without trusting redirects", () => {
    expect(mapStripeSubscriptionStatus("trialing")).toBe("TRIALING");
    expect(mapStripeSubscriptionStatus("active")).toBe("ACTIVE");
    expect(mapStripeSubscriptionStatus("past_due")).toBe("GRACE");
    expect(mapStripeSubscriptionStatus("canceled")).toBe("CANCELED_RETENTION");
  });

  it("maps Mercado Pago lifecycle to append-only transaction status", () => {
    expect(mapMercadoPagoPaymentStatus("approved")).toBe("CAPTURED");
    expect(mapMercadoPagoPaymentStatus("refunded")).toBe("REFUNDED");
    expect(mapMercadoPagoPaymentStatus("charged_back")).toBe("CHARGEBACK");
    expect(mapMercadoPagoPaymentStatus("rejected")).toBe("FAILED");
  });

  it("maps WhatsApp delivery callbacks", () => {
    expect(mapWhatsAppMessageStatus("delivered")).toBe("DELIVERED");
    expect(mapWhatsAppMessageStatus("read")).toBe("READ");
    expect(mapWhatsAppMessageStatus("future_status")).toBe("UNKNOWN");
  });
});
