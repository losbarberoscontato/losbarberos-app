export type SaasSubscriptionStatus =
  | "PROVISIONING"
  | "TRIALING"
  | "ACTIVE"
  | "GRACE"
  | "BLOCKED"
  | "CANCELED_RETENTION"
  | "CLOSED";

export type PaymentTransactionStatus =
  | "PENDING"
  | "CAPTURED"
  | "FAILED"
  | "CANCELED"
  | "REFUNDED"
  | "CHARGEBACK";

export type MessageDeliveryStatus =
  | "QUEUED"
  | "SENT"
  | "DELIVERED"
  | "READ"
  | "FAILED"
  | "DELETED"
  | "UNKNOWN";

export function mapStripeSubscriptionStatus(
  status: string,
): SaasSubscriptionStatus {
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
    case "incomplete":
    case "incomplete_expired":
    default:
      return "PROVISIONING";
  }
}

export function mapMercadoPagoPaymentStatus(
  status: string,
): PaymentTransactionStatus {
  switch (status) {
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
    case "pending":
    case "authorized":
    case "in_process":
    case "in_mediation":
    default:
      return "PENDING";
  }
}

export function mapWhatsAppMessageStatus(status: string): MessageDeliveryStatus {
  switch (status) {
    case "sent":
      return "SENT";
    case "delivered":
      return "DELIVERED";
    case "read":
      return "READ";
    case "failed":
      return "FAILED";
    case "deleted":
      return "DELETED";
    default:
      return "UNKNOWN";
  }
}
