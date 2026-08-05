import { endpoint, json, readJson } from "../_shared/http.ts";
import { processMercadoPagoRefundJobs } from "../_shared/mercado-pago-refunds.ts";
import { IntegrationError } from "../_shared/security.ts";
import { requireServiceInvocation, rpc } from "../_shared/supabase.ts";

type JobName =
  | "expire_holds"
  | "expire_billing_grace"
  | "process_retention"
  | "enqueue_whatsapp_reminders"
  | "reconcile_whatsapp_unknown"
  | "process_mercado_pago_refunds";

type RequestBody = { job?: unknown; limit?: unknown };

const procedures = {
  expire_holds: "expire_stale_appointment_holds",
  expire_billing_grace: "process_expired_billing_grace",
  process_retention: "process_expired_organization_retention",
  enqueue_whatsapp_reminders: "enqueue_due_whatsapp_reminders",
  reconcile_whatsapp_unknown: "mark_expired_notification_sends_unknown",
} satisfies Record<Exclude<JobName, "process_mercado_pago_refunds">, string>;

Deno.serve((request) =>
  endpoint(request, async () => {
    if (request.method !== "POST") {
      throw new IntegrationError(405, "METHOD_NOT_ALLOWED");
    }
    requireServiceInvocation(request);

    const body = await readJson<RequestBody>(request);
    const job = typeof body.job === "string" ? body.job as JobName : null;
    if (
      !job ||
      (job !== "process_mercado_pago_refunds" && !(job in procedures))
    ) {
      throw new IntegrationError(400, "INVALID_JOB");
    }

    const isProviderJob = job === "process_mercado_pago_refunds";
    const requestedLimit = Number(body.limit ?? (isProviderJob ? 10 : 200));
    const limit = Number.isSafeInteger(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), isProviderJob ? 10 : 1_000)
      : isProviderJob
      ? 10
      : 200;
    const result = isProviderJob
      ? await processMercadoPagoRefundJobs(limit)
      : await rpc<unknown>(procedures[job], { p_limit: limit });

    return json(request, { job, result });
  })
);
