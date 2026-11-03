import { runtimeHttp, type RuntimeRpcMetric } from "../../supabase/functions/_shared/whatsapp-runtime-http.ts";
import { runWhatsAppRuntime } from "../../supabase/functions/_shared/whatsapp-runtime.ts";

// Synthetic data only. This transport never delegates to fetch or a real host.
export async function measureRuntimeFixture(
  projected: boolean,
  jobs = 25,
  events = 2,
  providerStatus = 200,
) {
  const at = "2026-11-03T12:00:00.000Z";
  const jobRows = Array.from({ length: jobs }, (_, i) => ({
    id: `job-${i}`, organization_id: `org-${i}`, connection_id: `connection-${i}`,
    appointment_id: null, job_type: "MANUAL_OUTBOUND_TEXT", recipient_e164: "+5511000000000",
    payload: { body: "Olá {cliente}!", customer_name: "Cliente simulado", custom_key: "BIRTHDAY" },
    lease_token: `lease-${i}`, scheduled_for: at, appointment_version: null,
    confirmation_request_id: null, next_attempt_at: at, valid_until: null,
    status: "PROCESSING", attempt_count: 1, max_attempts: 5, locked_at: at,
    locked_by: "fixture-worker", lock_expires_at: at, dedupe_key: `fixture-${i}`,
    provider_message_id: null, last_error_code: null, last_error_detail: null,
    submitted_at: null, delivered_at: null, read_at: null, created_at: at, updated_at: at,
  }));
  const eventRows = Array.from({ length: events }, (_, i) => ({
    id: `event-${i}`, organization_id: `org-${i}`, connection_id: `connection-${i}`,
    lease_token: `event-lease-${i}`, payload: { text: "1", media: null },
    event_name_raw: "messages.upsert", event_name_normalized: "MESSAGES_UPSERT",
    provider_event_id: `provider-${i}`, fingerprint: `fingerprint-${i}`,
    processing_status: "PROCESSING", attempt_count: 1, received_at: at,
    processed_at: null, last_error: null, locked_at: at, locked_by: "fixture-worker", lock_expires_at: at,
  }));
  const metrics: RuntimeRpcMetric[] = [];
  const calls: { rpc: string; args: Record<string, unknown> }[] = [];
  const sends: unknown[] = [];
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.host === "provider.example.test") {
      sends.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ key: { id: "simulated-provider-id" } }), { status: providerStatus });
    }
    if (url.host !== "supabase.example.test") throw new Error("UNEXPECTED_FIXTURE_HOST");
    const rpc = url.pathname.split("/").at(-1)!;
    calls.push({ rpc, args: JSON.parse(String(init?.body)) });
    let data: unknown;
    switch (rpc) {
      case "whatsapp_runtime_schedule": data = jobs; break;
      case "whatsapp_runtime_claim": data = jobRows; break;
      case "whatsapp_runtime_claim_events": data = eventRows; break;
      case "whatsapp_runtime_prepare": data = { ready: true }; break;
      case "get_whatsapp_v2_qr_sender_context": data = { gateway_base_url: "https://provider.example.test", gateway_instance_id: "fixture", gateway_api_key: "fixture-only" }; break;
      case "whatsapp_runtime_start_send": case "whatsapp_runtime_finish": data = true; break;
      case "whatsapp_runtime_process_event": data = { processed: true }; break;
      case "whatsapp_runtime_heartbeat": return new Response(null, { status: 204 });
      default: throw new Error(`UNEXPECTED_FIXTURE_RPC:${rpc}`);
    }
    const select = projected ? url.searchParams.get("select") : null;
    if (select && Array.isArray(data)) {
      data = data.map((row) => Object.fromEntries(select.split(",").map((key) => [key, row[key]])));
    }
    return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
  };
  const deps = runtimeHttp("https://supabase.example.test", "fixture-only", request, (metric) => metrics.push(metric));
  const result = await runWhatsAppRuntime(deps, "fixture-worker");
  return {
    result, calls, sends, metrics,
    jsonBytes: metrics.reduce((sum, metric) => sum + metric.jsonBytes, 0),
  };
}
