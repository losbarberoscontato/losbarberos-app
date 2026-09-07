import type { RuntimeJob } from "./whatsapp-contracts.ts";
import { sendEvolutionText, validateImage } from "./whatsapp-delivery.ts";
import { textFor } from "./whatsapp-templates.ts";

export type Rpc = <T>(
  name: string,
  args: Record<string, unknown>,
) => Promise<T>;
type Event = {
  id: string;
  organization_id: string;
  connection_id: string;
  lease_token: string;
  payload: { media?: { key: Record<string, unknown> } };
};
type Sender = {
  gateway_base_url: string;
  gateway_instance_id: string;
  gateway_api_key: string;
};
export type RuntimeDependencies = {
  rpc: Rpc;
  fetch?: typeof fetch;
  storeImage: (event: Event, bytes: Uint8Array, mime: string) => Promise<void>;
  report: (code: string) => void;
};

export async function dispatchRuntimeJob(
  job: RuntimeJob,
  deps: RuntimeDependencies,
): Promise<void> {
  const rpc = deps.rpc;
  const prepared = await rpc<{ ready: boolean }>("whatsapp_runtime_prepare", {
    p_job_id: job.id,
    p_token: job.lease_token,
  });
  if (!prepared.ready) return;
  const sender = await rpc<Sender>("get_whatsapp_v2_qr_sender_context", {
    p_connection_id: job.connection_id,
  });
  if (
    !sender?.gateway_base_url || !sender.gateway_api_key ||
    !sender.gateway_instance_id
  ) throw new Error("SENDER_UNAVAILABLE");
  const body = textFor(job);
  const started = await rpc<boolean>("whatsapp_runtime_start_send", {
    p_job_id: job.id,
    p_token: job.lease_token,
  });
  if (!started) return;
  const outcome = await sendEvolutionText(
    sender,
    job.recipient_e164,
    body,
    deps.fetch,
  );
  // Never catch a persistence error here and translate it into another send.
  const completed = await rpc<boolean>("whatsapp_runtime_finish", {
    p_job_id: job.id,
    p_token: job.lease_token,
    p_outcome: outcome.status,
    p_body: body,
    p_provider_id: outcome.status === "SUBMITTED"
      ? outcome.providerMessageId
      : null,
    p_error: outcome.status === "SUBMITTED" ? null : outcome.code,
  });
  if (!completed) deps.report("STALE_COMPLETION_REQUIRES_RECONCILIATION");
}

async function limitedJson(
  response: Response,
): Promise<Record<string, unknown>> {
  if (!response.ok || !response.body) throw new Error("MEDIA_PROVIDER_FAILED");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 15 * 1024 * 1024) throw new Error("MEDIA_TOO_LARGE");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function ingestImage(
  event: Event,
  deps: RuntimeDependencies,
): Promise<void> {
  const sender = await deps.rpc<Sender>("get_whatsapp_v2_qr_sender_context", {
    p_connection_id: event.connection_id,
  });
  // The URL comes exclusively from the server-side connection configuration.
  // Provider-hosted URLs in inbound messages are never fetched or redirected to.
  const response = await (deps.fetch ?? fetch)(
    `${
      sender.gateway_base_url.replace(/\/$/, "")
    }/chat/getBase64FromMediaMessage/${
      encodeURIComponent(sender.gateway_instance_id)
    }`,
    {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: {
        apikey: sender.gateway_api_key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: { key: event.payload.media!.key },
        convertToMp4: false,
      }),
    },
  );
  const body = await limitedJson(response);
  if (typeof body.base64 !== "string") throw new Error("MEDIA_MISSING");
  const encoded = body.base64.replace(
    /^data:image\/(jpeg|png|webp);base64,/,
    "",
  );
  if (encoded.length > 14_000_000) throw new Error("MEDIA_TOO_LARGE");
  const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const mime = validateImage(bytes);
  await deps.rpc("whatsapp_runtime_store_image", {
    p_event_id: event.id,
    p_token: event.lease_token,
    p_mime: mime,
    p_size: bytes.length,
  });
  await deps.storeImage(event, bytes, mime);
}

export async function runWhatsAppRuntime(
  deps: RuntimeDependencies,
  workerId = crypto.randomUUID(),
  scope: "all" | "jobs" | "events" = "all",
): Promise<{ jobs: number; events: number }> {
  if (scope !== "events") {
    await deps.rpc("whatsapp_runtime_schedule", { p_limit: 500 });
  }
  const events = scope === "jobs"
    ? []
    : await deps.rpc<Event[]>("whatsapp_runtime_claim_events", {
      p_worker: workerId,
      p_limit: 2,
    });
  for (const event of events) {
    try {
      if (event.payload.media) await ingestImage(event, deps);
      await deps.rpc("whatsapp_runtime_process_event", {
        p_event_id: event.id,
        p_token: event.lease_token,
      });
    } catch {
      deps.report("WHATSAPP_EVENT_FAILED");
      await deps.rpc("whatsapp_runtime_event_finish", {
        p_event_id: event.id,
        p_token: event.lease_token,
        p_error: "EVENT_PROCESSING_FAILED",
      }).catch(() => deps.report("EVENT_PERSISTENCE_FAILED"));
    }
  }
  const jobs = scope === "events"
    ? []
    : await deps.rpc<RuntimeJob[]>("whatsapp_runtime_claim", {
      p_worker: workerId,
      p_limit: 25,
    });
  const results = await Promise.allSettled(
    jobs.map((job) => dispatchRuntimeJob(job, deps)),
  );
  for (const result of results) {
    if (result.status === "rejected") deps.report("WHATSAPP_JOB_FAILED");
  }
  if (scope !== "events") {
    await deps.rpc("whatsapp_runtime_heartbeat", { p_worker: workerId });
  }
  return { jobs: jobs.length, events: events.length };
}
