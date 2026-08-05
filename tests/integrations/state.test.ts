import { describe, expect, it } from "vitest";

import {
  createOpaqueToken,
  expiresAt,
  hashOpaqueToken,
  normalizeSafeReturnPath,
} from "@/lib/integrations/state";

describe("opaque integration state", () => {
  it("creates high-entropy URL-safe tokens and stores only a hash", async () => {
    const first = createOpaqueToken();
    const second = createOpaqueToken();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(second).not.toBe(first);
    expect(await hashOpaqueToken(first)).toMatch(/^[a-f0-9]{64}$/u);
    expect(await hashOpaqueToken(first)).toBe(await hashOpaqueToken(first));
  });

  it("uses a ten-minute default expiry", () => {
    const now = new Date("2026-08-04T12:00:00.000Z");

    expect(expiresAt(now).toISOString()).toBe("2026-08-04T12:10:00.000Z");
  });

  it.each([
    ["https://evil.example", "/app/integracoes"],
    ["//evil.example/path", "/app/integracoes"],
    ["/ok\\evil", "/app/integracoes"],
    ["/app/integracoes?ok=1", "/app/integracoes?ok=1"],
  ])("normalizes return path %s", (input, expected) => {
    expect(normalizeSafeReturnPath(input)).toBe(expected);
  });
});
