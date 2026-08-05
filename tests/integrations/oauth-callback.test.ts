import { describe, expect, it } from "vitest";
import { normalizeSafeReturnPath } from "@/lib/integrations/state";

describe("OAuth callback return path", () => {
  it("keeps local paths and rejects open redirects", () => {
    expect(normalizeSafeReturnPath("/gestor/agenda?dia=hoje", "/gestor")).toBe(
      "/gestor/agenda?dia=hoje",
    );
    expect(normalizeSafeReturnPath("//evil.example", "/gestor")).toBe("/gestor");
    expect(normalizeSafeReturnPath("https://evil.example", "/gestor")).toBe("/gestor");
    expect(normalizeSafeReturnPath("/gestor\\evil", "/gestor")).toBe("/gestor");
  });
});
