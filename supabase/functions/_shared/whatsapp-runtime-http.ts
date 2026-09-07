import type { Rpc, RuntimeDependencies } from "./whatsapp-runtime.ts";

export function runtimeHttp(
  supabaseUrl: string,
  serviceKey: string,
  request: typeof fetch = fetch,
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
    const response = await request(
      `${base}/rest/v1/rpc/${encodeURIComponent(name)}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(args),
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) throw new Error(`RUNTIME_RPC_FAILED:${name}`);
    const raw = await response.text();
    return (raw ? JSON.parse(raw) : null) as T;
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
