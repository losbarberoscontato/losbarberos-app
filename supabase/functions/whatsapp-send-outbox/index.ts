import { endpoint, json, readJson } from "../_shared/http.ts";
import { IntegrationError } from "../_shared/security.ts";
import { requireServiceInvocation, rpc } from "../_shared/supabase.ts";
import {
  evolutionRequest,
  normalizeWhatsAppRecipient,
  whatsappSenderForOrganization,
  whatsappRequest,
} from "../_shared/whatsapp.ts";

type RequestBody = { limit?: unknown };
type OutboxJob = {
  id: string;
  organization_id: string;
  recipient_e164: string;
  message_kind: "TEMPLATE" | "CANCEL_CONFIRM_PROMPT" | "TEXT";
  template_name?: string;
  language_code?: string;
  template_components?: unknown[];
  action_token?: string;
  appointment_label?: string;
  text_body?: string;
  attempt_number: number;
};

function buildMessage(job: OutboxJob): Record<string, unknown> {
  const to = normalizeWhatsAppRecipient(job.recipient_e164);

  if (job.message_kind === "TEMPLATE") {
    if (
      !job.template_name ||
      !/^[a-z0-9_]{1,512}$/u.test(job.template_name) ||
      !job.language_code ||
      !/^[a-z]{2,3}(?:_[A-Z]{2})?$/u.test(job.language_code)
    ) {
      throw new IntegrationError(422, "INVALID_OUTBOX_MESSAGE");
    }
    return {
      to,
      type: "template",
      template: {
        name: job.template_name,
        language: { code: job.language_code },
        ...(job.template_components
          ? { components: job.template_components }
          : {}),
      },
    };
  }

  if (job.message_kind === "CANCEL_CONFIRM_PROMPT") {
    if (
      !job.action_token || job.action_token.length < 22 ||
      job.action_token.length > 512
    ) {
      throw new IntegrationError(422, "INVALID_OUTBOX_MESSAGE");
    }
    return {
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: {
          text: `Confirma o cancelamento de ${
            job.appointment_label ?? "seu horário"
          }?`,
        },
        action: {
          buttons: [
            {
              type: "reply",
              reply: { id: job.action_token, title: "Confirmar" },
            },
            {
              type: "reply",
              reply: { id: "keep_appointment", title: "Manter horário" },
            },
          ],
        },
      },
    };
  }

  if (job.message_kind === "TEXT" && job.text_body?.trim()) {
    return { to, type: "text", text: { body: job.text_body.slice(0, 4_096) } };
  }

  throw new IntegrationError(422, "INVALID_OUTBOX_MESSAGE");
}

function buildEvolutionText(job: OutboxJob): string {
  if (job.text_body?.trim()) return job.text_body.slice(0, 4_096);
  const label = job.appointment_label?.trim() || "o seu horário";
  switch (job.template_name) {
    case "appointment_reminder_6h":
      return `Lembrete: seu atendimento será em ${label}.`;
    case "appointment_reminder_45m":
      return `Lembrete: seu atendimento começa em ${label}.`;
    case "appointment_confirmation":
      return `Seu agendamento foi confirmado para ${label}.`;
    case "appointment_cancellation_confirmed":
      return "Seu cancelamento foi confirmado.";
    default:
      return `Atualização do seu agendamento: ${label}.`;
  }
}

Deno.serve((request) =>
  endpoint(request, async () => {
    if (request.method !== "POST") {
      throw new IntegrationError(405, "METHOD_NOT_ALLOWED");
    }
    requireServiceInvocation(request);

    const body = await readJson<RequestBody>(request);
    const requestedLimit = Number(body.limit ?? 20);
    const limit = Number.isSafeInteger(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 50)
      : 20;
    const workerId = crypto.randomUUID();
    let claimed = 0;
    let sent = 0;
    let failed = 0;
    let unknown = 0;

    // Claim one job at a time. A slow provider call cannot consume lease time from
    // jobs waiting behind it in a pre-claimed batch.
    while (claimed < limit) {
      const jobs = await rpc<OutboxJob[]>("claim_notification_outbox", {
        p_provider: "WHATSAPP",
        p_limit: 1,
        p_worker_id: workerId,
        p_lease_seconds: 120,
      });
      const job = jobs?.[0];
      if (!job) {
        break;
      }
      claimed += 1;

      // SENDING is a durable uncertainty boundary. If provider accepts but DB
      // completion fails, lease expiry converts it to SEND_UNKNOWN, never retry.
      const begun = await rpc<boolean>("begin_notification_send", {
        p_outbox_id: job.id,
        p_worker_id: workerId,
      });
      if (!begun) {
        unknown += 1;
        continue;
      }

      let messageId: string;
      try {
        const sender = await whatsappSenderForOrganization(job.organization_id);
        const result = sender.provider === "META_CLOUD"
          ? await whatsappRequest(sender.phoneNumberId, sender.accessToken, buildMessage(job))
          : await evolutionRequest(sender, job.recipient_e164, buildEvolutionText(job));
        messageId = result.messages?.[0]?.id ?? "";
        if (!messageId) {
          throw new IntegrationError(502, "INVALID_PROVIDER_RESPONSE", true);
        }
      } catch (error) {
        const providerOutcomeUnknown = error instanceof IntegrationError &&
          ["PROVIDER_TIMEOUT", "INVALID_PROVIDER_RESPONSE"].includes(
            error.code,
          );
        if (providerOutcomeUnknown) {
          console.error("notification_send_provider_unknown", {
            outboxId: job.id,
          });
          unknown += 1;
          continue;
        }

        const retryable = error instanceof IntegrationError && error.retryable;
        await rpc("complete_notification_attempt", {
          p_outbox_id: job.id,
          p_worker_id: workerId,
          p_succeeded: false,
          p_external_message_id: null,
          p_error_code: error instanceof IntegrationError
            ? error.code
            : "SEND_FAILED",
          p_retryable: retryable,
        });
        failed += 1;
        continue;
      }

      try {
        await rpc("complete_notification_attempt", {
          p_outbox_id: job.id,
          p_worker_id: workerId,
          p_succeeded: true,
          p_external_message_id: messageId,
          p_error_code: null,
          p_retryable: false,
        });
        sent += 1;
      } catch {
        // Never downgrade provider acceptance to a retryable send failure. DB
        // keeps SENDING until lease expiry records SEND_UNKNOWN.
        console.error("notification_send_completion_unknown", {
          outboxId: job.id,
        });
        unknown += 1;
      }
    }

    return json(request, { claimed, sent, failed, unknown });
  })
);
