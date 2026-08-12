import { describe, expect, it } from "vitest";
import { DEFAULT_PUBLIC_SITE_ORIGIN, resolvePublicSiteOrigin } from "@/lib/public-site";

describe("public site origin", () => {
  it("uses the current production domain by default", () => {
    expect(DEFAULT_PUBLIC_SITE_ORIGIN).toBe("https://losbarberos-app.vercel.app");
    expect(resolvePublicSiteOrigin()).toBe(DEFAULT_PUBLIC_SITE_ORIGIN);
  });

  it("normalizes a future production URL to its origin", () => {
    expect(resolvePublicSiteOrigin("https://losbarberos.com.br/agenda?origem=meta"))
      .toBe("https://losbarberos.com.br");
  });

  it("allows localhost for development", () => {
    expect(resolvePublicSiteOrigin("http://localhost:3000/privacidade"))
      .toBe("http://localhost:3000");
    expect(resolvePublicSiteOrigin("http://[::1]:3000/termos"))
      .toBe("http://[::1]:3000");
  });

  it("rejects unsafe or invalid origins", () => {
    expect(resolvePublicSiteOrigin("javascript:alert(1)"))
      .toBe(DEFAULT_PUBLIC_SITE_ORIGIN);
    expect(resolvePublicSiteOrigin("not-a-url"))
      .toBe(DEFAULT_PUBLIC_SITE_ORIGIN);
    expect(resolvePublicSiteOrigin("http://example.com"))
      .toBe(DEFAULT_PUBLIC_SITE_ORIGIN);
  });
});
