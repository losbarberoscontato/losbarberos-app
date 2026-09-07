import {
  type EvolutionMessageKey,
  isGroupOrBroadcastMessage,
  senderPhoneFromMessageKey,
} from "./evolution-message.ts";
import type { CanonicalMessage } from "./whatsapp-contracts.ts";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function normalizeEvolutionMessages(
  event: string,
  instance: string,
  data: unknown,
): CanonicalMessage[] {
  const result: CanonicalMessage[] = [];
  for (const item of Array.isArray(data) ? data : [data]) {
    const row = record(item);
    const key = record(row.key) as EvolutionMessageKey;
    const id = typeof key.id === "string"
      ? key.id
      : typeof row.keyId === "string"
      ? row.keyId
      : null;
    if (!id || isGroupOrBroadcastMessage(key)) continue;
    const message = record(row.message);
    const extended = record(message.extendedTextMessage);
    const image = record(message.imageMessage);
    const context = record(extended.contextInfo ?? image.contextInfo);
    const update = record(row.update);
    const state = String(row.status ?? update.status ?? "").toUpperCase();
    const receipt = ({
      "0": "FAILED",
      "2": "SUBMITTED",
      "3": "DELIVERED",
      "4": "READ",
      "5": "READ",
      ERROR: "FAILED",
      SERVER_ACK: "SUBMITTED",
      DELIVERY_ACK: "DELIVERED",
      READ: "READ",
      PLAYED: "READ",
    } as const)[state as "0"] ?? null;
    if (event === "MESSAGES_UPSERT" && key.fromMe) continue;
    if (event === "MESSAGES_UPDATE" && !receipt) continue;
    result.push({
      gateway_instance_id: instance,
      external_id: id,
      event_name: event as CanonicalMessage["event_name"],
      sender_e164: senderPhoneFromMessageKey(key),
      from_me: Boolean(key.fromMe),
      text: typeof message.conversation === "string"
        ? message.conversation
        : typeof extended.text === "string"
        ? extended.text
        : null,
      quoted_id: typeof context.stanzaId === "string" ? context.stanzaId : null,
      receipt: event === "MESSAGES_UPDATE" ? receipt : null,
      // Store only a provider message key. Never download arbitrary webhook URLs.
      media: event === "MESSAGES_UPSERT" && Object.keys(image).length > 0
        ? { key: { id, remoteJid: key.remoteJid, fromMe: false } }
        : null,
    });
  }
  return result;
}

export function eventIdentity(event: CanonicalMessage): string {
  return `${event.event_name}:${event.gateway_instance_id}:${event.external_id}:${
    event.receipt ?? "message"
  }`;
}
