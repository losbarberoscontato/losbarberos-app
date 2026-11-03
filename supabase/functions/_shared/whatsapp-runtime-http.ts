import type { Rpc, RuntimeDependencies } from "./whatsapp-runtime.ts";

// These RPCs return table rows. Keep their SQL contracts/claims intact and ask
// PostgREST to serialize only fields consumed by this runtime.
const rpcColumns: Record<string, string> = {
  whatsapp_runtime_claim:
    "id,organization_id,connection_id,appointment_id,job_type,recipient_e164,payload,lease_token,scheduled_for",
  whatsapp_runtime_claim_events:
    "id,organization_id,connection_id,lease_token,payload",
  whatsapp_runtime_expired_images: "id,object_path",
};

export type RuntimeRpcMetric = {
  rpc: string;
  status: number;
  durationMs: number;
  jsonBytes: number;
  rows: number;
  ok: boolean;
};

export function runtimeHttp(
  supabaseUrl: string,
  serviceKey: string,
  request: typeof fetch = fetch,
  observe?: (metric: RuntimeRpcMetric) => void,
): RuntimeDependencies {
  const base = supabaseUrl.replace(/\/$/, "");
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
  const rpc: Rpc = async <T>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<T> => {
    const started = performance.now();
    let status = 0;
    let jsonBytes = 0;
    let rows = 0;
    let ok = false;
    try {
      const columns = rpcColumns[name];
      const query = columns ? `?select=${encodeURIComponent(columns)}` : "";
      const response = await request(
        `${base}/rest/v1/rpc/${encodeURIComponent(name)}${query}`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(args),
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
        },
      );
      status = response.status;
      if (!response.ok) throw new Error(`RUNTIME_RPC_FAILED:${name}`);
      const raw = await response.text();
      if (observe) jsonBytes = new TextEncoder().encode(raw).byteLength;
      const result = raw ? JSON.parse(raw) : null;
      rows = Array.isArray(result) ? result.length : 0;
      ok = true;
      return result as T;
    } finally {
      // Optional local measurement: no tokens, arguments, bodies, IDs or phones.
      // Decoded JSON bytes are NOT wire bytes or Supabase-billed Egress.
      try {
        observe?.({
          rpc: name,
          status,
          durationMs: performance.now() - started,
          jsonBytes,
          rows,
          ok,
        });
      } catch {
        // Instrumentation must never change delivery or retry behavior.
      }
    }
  };
  return {
    rpc,
    fetch: request,
    report: (code) => console.error(code),
    storeImage: async (event, bytes, mime) => {
      const response = await request(
        `${base}/storage/v1/object/whatsapp-private/${event.organization_id}/${event.id}`,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": mime, "x-upsert": "false" },
          body: bytes as unknown as BodyInit,
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!response.ok) {
        const error = await response.json().catch(() => ({})) as {
          statusCode?: string;
          error?: string;
        };
        if (
          response.status !== 409 && error.statusCode !== "409" &&
          error.error !== "Duplicate"
        ) throw new Error("IMAGE_STORAGE_FAILED");
      }
    },
  };
}

export async function deleteExpiredImages(
  deps: RuntimeDependencies,
  supabaseUrl: string,
  serviceKey: string,
): Promise<void> {
  const expired = await deps.rpc<{ id: string; object_path: string }[]>(
    "whatsapp_runtime_expired_images",
    {},
  );
  for (const image of expired) {
    const response = await (deps.fetch ?? fetch)(
      `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/whatsapp-private`,
      {
        method: "DELETE",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prefixes: [image.object_path] }),
      },
    );
    if (response.ok) {
      await deps.rpc("whatsapp_runtime_image_deleted", { p_id: image.id });
    }
  }
}
