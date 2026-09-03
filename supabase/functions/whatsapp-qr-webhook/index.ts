import { requiredEnv } from "../_shared/env.ts";
import {
  type EvolutionMessageKey,
  isGroupOrBroadcastMessage,
  senderPhoneFromMessageKey,
} from "../_shared/evolution-message.ts";
import { endpoint, json } from "../_shared/http.ts";
import { providerFetch } from "../_shared/provider-http.ts";
import {
  IntegrationError,
  sha256Hex,
  verifySharedSecretHeader,
} from "../_shared/security.ts";
import { rpc } from "../_shared/supabase.ts";

type EvolutionPayload = {
  event?: string;
  instance?: string;
  data?: {
    state?: string;
    statusReason?: string;
    base64?: string;
    qrcode?: { base64?: string };
    key?: EvolutionMessageKey;
    message?: {
      conversation?: string;
      extendedTextMessage?: { text?: string };
    };
  };
};
type InstanceInfo = {
  ownerJid?: unknown;
  number?: unknown;
  instance?: { ownerJid?: unknown; number?: unknown };
};

function phone(value: unknown): string | null {
  const match = /^(\d{10,15})(?::\d+)?(?:@(s\.whatsapp\.net|c\.us))?$/iu.exec(
    typeof value === "string" ? value : "",
  );
  return match ? `+${match[1]}` : null;
}

async function syncConnectedPhone(
  instanceName: string,
  input?: unknown,
): Promise<void> {
  try {
    const values = Array.isArray(input) ? input : [input];
    let found: string | null = null;
    for (const value of values) {
      const row = value as InstanceInfo | undefined;
      found = phone(row?.ownerJid) ?? phone(row?.number) ??
        phone(row?.instance?.ownerJid) ?? phone(row?.instance?.number);
      if (found) break;
    }
    if (!found) {
      const url = new URL(
        `${
          requiredEnv("EVOLUTION_API_BASE_URL").replace(/\/$/u, "")
        }/instance/fetchInstances`,
      );
      url.searchParams.set("instanceName", instanceName);
      const result = await providerFetch<unknown>(url.toString(), {
        method: "GET",
        headers: { apikey: requiredEnv("EVOLUTION_API_KEY") },
      });
      for (const value of (Array.isArray(result) ? result : [result])) {
        const row = value as InstanceInfo;
        found = phone(row.ownerJid) ?? phone(row.number) ??
          phone(row.instance?.ownerJid) ?? phone(row.instance?.number);
        if (found) break;
      }
    }
    if (found) {
      await rpc("store_whatsapp_qr_connected_phone", {
        p_gateway_instance_id: instanceName,
        p_connected_phone_e164: found,
      });
    }
  } catch (error) {
    console.error("whatsapp_connected_phone_sync_failed", {
      errorCode: error instanceof IntegrationError
        ? error.code
        : "UNKNOWN_ERROR",
    });
  }
}

function text(data: EvolutionPayload["data"]): string | null {
  return data?.message?.conversation?.trim() ||
    data?.message?.extendedTextMessage?.text?.trim() || null;
}

async function triggerV2Dispatcher(): Promise<void> {
  try {
    const baseUrl = requiredEnv("SUPABASE_URL").replace(/\/$/u, "");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const response = await fetch(
      `${baseUrl}/functions/v1/whatsapp-v2-dispatcher`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({ limit: 25 }),
      },
    );
    if (!response.ok) {
      console.error("whatsapp_v2_dispatch_trigger_failed", {
        status: response.status,
      });
    }
  } catch (error) {
    console.error("whatsapp_v2_dispatch_trigger_failed", {
      errorCode: error instanceof IntegrationError
        ? error.code
        : "UNKNOWN_ERROR",
    });
  }
}

Deno.serve((request) =>
  endpoint(request, async () => {
    if (request.method !== "POST") {
      throw new IntegrationError(405, "METHOD_NOT_ALLOWED");
    }
    const raw = await request.text();
    if (
      !verifySharedSecretHeader(
        request.headers.get("x-evolution-webhook-secret"),
        requiredEnv("EVOLUTION_WEBHOOK_SECRET"),
      )
    ) {
      throw new IntegrationError(401, "INVALID_SIGNATURE");
    }
    let payload: EvolutionPayload;
    try {
      payload = JSON.parse(raw) as EvolutionPayload;
    } catch {
      throw new IntegrationError(400, "INVALID_JSON");
    }
    if (!payload.instance) return json(request, { received: true });
    const event = payload.event?.toUpperCase().replaceAll(".", "_") ??
      "UNKNOWN";
    if (event === "QRCODE_UPDATED") {
      const code = payload.data?.base64 ?? payload.data?.qrcode?.base64;
      if (code) {
        await rpc("store_whatsapp_qr_code", {
          p_gateway_instance_id: payload.instance,
          p_qr_code: code,
          p_expires_at: new Date(Date.now() + 300_000).toISOString(),
        });
      }
      return json(request, { received: true, qrStored: Boolean(code) });
    }
    if (event === "CONNECTION_UPDATE" && payload.data?.state) {
      const updated = await rpc<boolean>("update_whatsapp_qr_status", {
        p_gateway_instance_id: payload.instance,
        p_status: payload.data.state,
        p_error_code: payload.data.statusReason?.slice(0, 255) ?? null,
      });
      if (
        ["open", "connected"].includes(payload.data.state.toLowerCase())
      ) await syncConnectedPhone(payload.instance, payload.data);
      return json(request, { received: true, updated });
    }
    if (
      event !== "MESSAGES_UPSERT" && event !== "MESSAGES_UPDATE"
    ) return json(request, { received: true });
    const key = payload.data?.key;
    if (key?.fromMe || isGroupOrBroadcastMessage(key)) {
      return json(request, { received: true });
    }
    const externalId = key?.id ?? null;
    const normalized = {
      gateway_instance_id: payload.instance,
      sender_e164: senderPhoneFromMessageKey(key),
      text: text(payload.data),
      from_me: Boolean(key?.fromMe),
    };
    const fingerprint = await sha256Hex(
      `${event}:${payload.instance}:${externalId ?? raw}`,
    );
    const eventId = await rpc<string | null>(
      "record_whatsapp_v2_webhook_event",
      {
        p_gateway_instance_id: payload.instance,
        p_event_name: event,
        p_provider_event_id: externalId,
        p_fingerprint: fingerprint,
        p_payload: normalized,
      },
    );
    // Low-latency path. The minute cron remains the durable fallback.
    if (eventId) EdgeRuntime.waitUntil(triggerV2Dispatcher());
    return json(request, { received: true, queued: true });
  })
);
