import { afterEach, describe, expect, it, vi } from "vitest";

import { providerFetch } from "../../supabase/functions/_shared/provider-http";

function response(status: number, retryAfter?: string): Response {
  return new Response(JSON.stringify({ error: "provider failure" }), {
    status,
    headers: retryAfter ? { "retry-after": retryAfter } : undefined,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("providerFetch retry classification", () => {
  it.each([408, 423, 429])("marks provider HTTP %s as retryable", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(status)));

    await expect(providerFetch("https://provider.example/resource", {})).rejects
      .toMatchObject({
        code: "PROVIDER_REQUEST_FAILED",
        retryable: true,
      });
  });

  it("keeps other provider 4xx failures non-retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(400, "30")));

    await expect(providerFetch("https://provider.example/resource", {})).rejects
      .toMatchObject({
        retryable: false,
        retryAfterSeconds: undefined,
      });
  });

  it("preserves delta-seconds Retry-After metadata", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(429, "37")));

    await expect(providerFetch("https://provider.example/resource", {})).rejects
      .toMatchObject({
        retryable: true,
        retryAfterSeconds: 37,
      });
  });

  it("normalizes HTTP-date Retry-After metadata", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T12:00:00.000Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response(503, "Tue, 04 Aug 2026 12:00:45 GMT")),
    );

    await expect(providerFetch("https://provider.example/resource", {})).rejects
      .toMatchObject({
        retryable: true,
        retryAfterSeconds: 45,
      });
  });
});
