import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workspace = process.cwd();

describe("PWA public cache contract", () => {
  it("declares standalone client entrypoint and required icon sizes", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(workspace, "public/manifest.webmanifest"), "utf8"),
    ) as {
      display?: string;
      start_url?: string;
      icons?: Array<{ sizes?: string; purpose?: string }>;
    };

    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toMatch(/^\/cliente\//u);
    expect(manifest.icons?.some((icon) => icon.sizes === "192x192")).toBe(true);
    expect(manifest.icons?.some((icon) => icon.sizes === "512x512")).toBe(true);
    expect(manifest.icons?.some((icon) => icon.purpose === "maskable")).toBe(true);
  });

  it("never caches navigations, APIs, auth or business payloads", () => {
    const worker = readFileSync(resolve(workspace, "public/sw.js"), "utf8");

    expect(worker).toContain('request.mode === "navigate"');
    expect(worker).toContain('fetch(request).catch(() => caches.match("/offline.html"))');
    expect(worker).not.toMatch(/cache\.put\s*\(\s*request/iu);
    expect(worker).not.toMatch(/\/api|\/auth|agenda|clientes|pagamentos|\.json/iu);
  });
});
