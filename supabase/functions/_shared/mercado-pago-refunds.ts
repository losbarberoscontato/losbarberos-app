import { mercadoPagoAccessToken, mercadoPagoRequest } from "./mercado-pago.ts";
import { IntegrationError } from "./security.ts";
import { rpc } from "./supabase.ts";

export type MercadoPagoRefundJob = {
  refund_job_id: string;
  organization_id?: string;
  payment_order_id?: string;
  appointment_id?: string;
  provider_payment_id: string;
  amount_cents: number;
  currency?: string;
  idempotency_key: string;
  reason?: string;
  attempt_number?: number;
  access_token: string;
};

type MercadoPagoRefund = {
  id?: number | string;
  status?: string;
  amount?: number;
};

export type MercadoPagoRefundResult = {
  refundId: string;
  status: string;
};

function errorCode(error: unknown): string {
  return error instanceof IntegrationError ? error.code : "REFUND_FAILED";
}

async function recordFailure(
  job: MercadoPagoRefundJob,
  workerId: string | null,
  error: unknown,
): Promise<void> {
  try {
    await rpc("fail_mercado_pago_refund_job", {
      p_refund_job_id: job.refund_job_id,
      p_worker_id: workerId,
      p_error_code: errorCode(error),
      p_retryable: !(error instanceof IntegrationError) || error.retryable,
    });
  } catch {
    console.error("mercado_pago_refund_failure_persistence_unknown", {
      refundJobId: job.refund_job_id,
    });
  }
}

export async function executeMercadoPagoRefundJob(
  job: MercadoPagoRefundJob,
  workerId: string | null,
): Promise<MercadoPagoRefundResult> {
  if (
    !job.refund_job_id ||
    !job.organization_id ||
    !job.provider_payment_id ||
    !job.access_token ||
    !job.idempotency_key ||
    !Number.isSafeInteger(job.amount_cents) ||
    job.amount_cents < 1 ||
    (job.currency !== undefined && job.currency !== "BRL")
  ) {
    const error = new IntegrationError(500, "INVALID_REFUND_JOB");
    await recordFailure(job, workerId, error);
    throw error;
  }

  let refund: MercadoPagoRefund;
  try {
    const accessToken = await mercadoPagoAccessToken(job.organization_id);
    refund = await mercadoPagoRequest<MercadoPagoRefund>(
      `/v1/payments/${encodeURIComponent(job.provider_payment_id)}/refunds`,
      accessToken,
      {
        method: "POST",
        body: JSON.stringify({ amount: job.amount_cents / 100 }),
      },
      job.idempotency_key,
    );
    if (
      refund.id === undefined || refund.id === null ||
      String(refund.id).length === 0
    ) {
      throw new IntegrationError(502, "INVALID_PROVIDER_RESPONSE", true);
    }
  } catch (error) {
    await recordFailure(job, workerId, error);
    throw error;
  }

  const result = {
    refundId: String(refund.id),
    status: refund.status ?? "approved",
  };

  try {
    await rpc("complete_mercado_pago_refund_job", {
      p_refund_job_id: job.refund_job_id,
      p_worker_id: workerId,
      p_external_refund_id: result.refundId,
      p_amount_cents: job.amount_cents,
      p_status: result.status,
    });
  } catch (error) {
    // Mercado Pago idempotency key makes a later durable retry safe even when
    // provider accepted but local completion could not be persisted.
    await recordFailure(job, workerId, error);
    throw error;
  }

  return result;
}

export async function processMercadoPagoRefundJobs(limit: number): Promise<{
  claimed: number;
  completed: number;
  failed: number;
}> {
  const workerId = crypto.randomUUID();
  let claimed = 0;
  let completed = 0;
  let failed = 0;

  while (claimed < limit) {
    const jobs = await rpc<MercadoPagoRefundJob[]>(
      "claim_mercado_pago_refund_jobs",
      {
        p_limit: 1,
        p_worker_id: workerId,
        p_lease_seconds: 120,
      },
    );
    const job = jobs?.[0];
    if (!job) break;
    claimed += 1;

    try {
      await executeMercadoPagoRefundJob(job, workerId);
      completed += 1;
    } catch {
      failed += 1;
    }
  }

  return { claimed, completed, failed };
}
