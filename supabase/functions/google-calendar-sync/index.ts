import {
  deterministicGoogleEventId,
  googleCalendarApiUrl,
  googleCalendarRequest,
  refreshGoogleAccessToken,
} from "../_shared/google-calendar.ts";
import { endpoint } from "../_shared/http.ts";
import { IntegrationError } from "../_shared/security.ts";
import { requireServiceInvocation, rpc } from "../_shared/supabase.ts";

type Job = { id: string };
type Connection = {
  id: string;
  targetType: string;
  barberId: string | null;
  calendarId: string;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: string | null;
};
type EventLink = { connectionId: string; calendarId: string; eventId: string };
type SyncContext = {
  jobId: string;
  organizationId: string;
  appointmentId: string;
  status: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  room: string;
  customer: string;
  service: string;
  professional: string;
  eventLinks: EventLink[];
  connections: Connection[];
};

async function saveToken(
  connection: Connection,
  accessToken: string,
  expiresIn: number,
) {
  await rpc("refresh_google_calendar_access_token", {
    p_connection_id: connection.id,
    p_access_token: accessToken,
    p_expires_at: new Date(Date.now() + expiresIn * 1_000).toISOString(),
  });
}

async function withFreshToken(connection: Connection): Promise<string> {
  if (!connection.accessToken) {
    throw new IntegrationError(401, "GOOGLE_ACCESS_TOKEN_MISSING");
  }
  if (
    connection.expiresAt &&
    Date.parse(connection.expiresAt) > Date.now() + 60_000
  ) {
    return connection.accessToken;
  }
  if (!connection.refreshToken) {
    throw new IntegrationError(401, "GOOGLE_REFRESH_TOKEN_MISSING");
  }
  const token = await refreshGoogleAccessToken(connection.refreshToken);
  await saveToken(connection, token.access_token, token.expires_in);
  return token.access_token;
}

async function requestWithRefresh(
  connection: Connection,
  accessToken: string,
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: Record<string, unknown>,
): Promise<Response> {
  let response = await googleCalendarRequest(accessToken, url, method, body);
  if (response.status === 403) {
    await rpc("mark_google_calendar_reauth_required", {
      p_connection_id: connection.id,
      p_error: "GOOGLE_CALENDAR_PERMISSION_DENIED",
    });
    return response;
  }
  if (response.status !== 401) return response;
  if (!connection.refreshToken) {
    await rpc("mark_google_calendar_reauth_required", {
      p_connection_id: connection.id,
      p_error: "GOOGLE_REFRESH_TOKEN_MISSING",
    });
    return response;
  }
  try {
    const token = await refreshGoogleAccessToken(connection.refreshToken);
    await saveToken(connection, token.access_token, token.expires_in);
    response = await googleCalendarRequest(
      token.access_token,
      url,
      method,
      body,
    );
  } catch {
    await rpc("mark_google_calendar_reauth_required", {
      p_connection_id: connection.id,
      p_error: "GOOGLE_TOKEN_REFRESH_FAILED",
    });
    return response;
  }
  if (response.status === 401) {
    await rpc("mark_google_calendar_reauth_required", {
      p_connection_id: connection.id,
      p_error: "GOOGLE_ACCESS_REJECTED",
    });
  }
  return response;
}

async function syncOneConnection(context: SyncContext, connection: Connection) {
  let accessToken: string;
  try {
    accessToken = await withFreshToken(connection);
  } catch (error) {
    if (error instanceof IntegrationError && error.status === 401) {
      await rpc("mark_google_calendar_reauth_required", {
        p_connection_id: connection.id,
        p_error: error.code,
      });
    }
    throw error;
  }
  const previousLink = context.eventLinks.find((link) =>
    link.connectionId === connection.id
  );
  const eventId = previousLink?.eventId ??
    deterministicGoogleEventId(context.appointmentId);
  const endpoint = googleCalendarApiUrl(connection.calendarId, eventId);
  const shouldDelete = ["CANCELED", "NO_SHOW", "EXPIRED"].includes(
    context.status,
  );
  if (shouldDelete) {
    const result = await requestWithRefresh(
      connection,
      accessToken,
      endpoint,
      "DELETE",
    );
    if (!result.ok && result.status !== 404 && result.status !== 410) {
      throw new IntegrationError(
        result.status === 401 ? 401 : 502,
        `GOOGLE_DELETE_${result.status}`,
        true,
      );
    }
    if (previousLink) {
      await rpc("delete_google_calendar_event_link", {
        p_connection_id: connection.id,
        p_appointment_id: context.appointmentId,
      });
    }
    await rpc("record_google_calendar_sync_result", {
      p_connection_id: connection.id,
      p_error: null,
    });
    return;
  }
  const event = {
    id: eventId,
    summary:
      `${context.room} | ${context.customer} | ${context.service} | ${context.professional}`,
    start: { dateTime: context.startsAt, timeZone: context.timeZone },
    end: { dateTime: context.endsAt, timeZone: context.timeZone },
  };
  let result = await requestWithRefresh(
    connection,
    accessToken,
    endpoint,
    "PATCH",
    event,
  );
  if (result.status === 404) {
    result = await requestWithRefresh(
      connection,
      accessToken,
      googleCalendarApiUrl(connection.calendarId),
      "POST",
      event,
    );
  } else if (result.status === 410) {
    result = await requestWithRefresh(
      connection,
      accessToken,
      googleCalendarApiUrl(connection.calendarId),
      "POST",
      event,
    );
  }
  if (result.status === 409) {
    result = await requestWithRefresh(
      connection,
      accessToken,
      endpoint,
      "PATCH",
      event,
    );
  }
  if (!result.ok) {
    throw new IntegrationError(
      result.status === 401 ? 401 : 502,
      `GOOGLE_UPSERT_${result.status}`,
      true,
    );
  }
  const saved = await result.json().catch(() => null) as { id?: string } | null;
  if (!saved?.id) {
    throw new IntegrationError(502, "GOOGLE_EVENT_ID_MISSING", true);
  }
  await rpc("save_google_calendar_event_link", {
    p_organization_id: context.organizationId,
    p_connection_id: connection.id,
    p_appointment_id: context.appointmentId,
    p_calendar_id: connection.calendarId,
    p_event_id: saved.id,
    p_version: 1,
  });
  await rpc("record_google_calendar_sync_result", {
    p_connection_id: connection.id,
    p_error: null,
  });
}

Deno.serve((request) =>
  endpoint(request, async () => {
    if (request.method !== "POST") {
      throw new IntegrationError(405, "METHOD_NOT_ALLOWED");
    }
    requireServiceInvocation(request);
    const body = await request.json().catch(() => ({})) as { limit?: unknown };
    const limit = Number.isInteger(body.limit)
      ? Math.max(1, Math.min(Number(body.limit), 50))
      : 25;
    const worker = crypto.randomUUID();
    const jobs = await rpc<Job[]>("claim_google_calendar_sync_jobs", {
      p_limit: limit,
      p_worker: worker,
    });
    let done = 0;
    let failed = 0;
    for (const job of jobs ?? []) {
      try {
        const context = await rpc<SyncContext | null>(
          "get_google_calendar_sync_context",
          { p_job_id: job.id },
        );
        if (context?.connections?.length) {
          const errors: string[] = [];
          for (const connection of context.connections) {
            try {
              await syncOneConnection(context, connection);
            } catch (error) {
              const message = error instanceof Error
                ? error.message
                : "GOOGLE_SYNC_FAILED";
              await rpc("record_google_calendar_sync_result", {
                p_connection_id: connection.id,
                p_error: message,
              });
              errors.push(message);
            }
          }
          if (errors.length) {
            throw new Error(errors.slice(0, 3).join("; "));
          }
        }
        await rpc("complete_google_calendar_sync_job", {
          p_job_id: job.id,
          p_worker: worker,
          p_error: null,
        });
        done += 1;
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : "GOOGLE_SYNC_FAILED";
        await rpc("complete_google_calendar_sync_job", {
          p_job_id: job.id,
          p_worker: worker,
          p_error: message,
        });
        failed += 1;
      }
    }
    return Response.json({ claimed: jobs?.length ?? 0, done, failed });
  })
);
