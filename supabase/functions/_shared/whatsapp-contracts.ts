/** Provider-independent contracts. No application tables or credentials cross this boundary. */
export type BusinessEvent = {
  schema_version: 1;
  organization_id: string;
  aggregate_id: string;
  aggregate_version: number;
  type:
    | "appointment.confirmed"
    | "appointment.updated"
    | "appointment.canceled"
    | "appointment.completed"
    | "customer.updated"
    | "consent.updated";
  occurred_at: string;
};

export type DeliveryOutcome =
  | { status: "SUBMITTED"; providerMessageId: string }
  | { status: "RETRY"; code: string }
  | { status: "FAILED"; code: string }
  | { status: "SEND_UNKNOWN"; code: string };

export type RuntimeJob = {
  id: string;
  organization_id: string;
  connection_id: string;
  appointment_id: string | null;
  job_type: string;
  recipient_e164: string;
  payload: Record<string, unknown>;
  lease_token: string;
  scheduled_for: string;
};

export type PrivateImage = {
  id: string;
  organization_id: string;
  connection_id: string;
  object_path: string;
  mime_type: "image/jpeg" | "image/png" | "image/webp";
  expires_at: string;
};

/** Deliberately not instantiated in v1. Media is never automatically sent to an AI. */
export interface VisagismAgent {
  respond(
    input: {
      organization_id: string;
      conversation_id: string;
      images: PrivateImage[];
      text?: string;
    },
  ): Promise<{ text: string }>;
}

export type CanonicalMessage = {
  gateway_instance_id: string;
  external_id: string;
  event_name: "MESSAGES_UPSERT" | "MESSAGES_UPDATE";
  sender_e164: string | null;
  from_me: boolean;
  text: string | null;
  quoted_id: string | null;
  receipt: "SUBMITTED" | "DELIVERED" | "READ" | "FAILED" | null;
  media: { key: Record<string, unknown> } | null;
};
