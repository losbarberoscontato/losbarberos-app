import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("project comment history order", () => {
  it("loads manager and barber histories newest first", () => {
    const manager = readFileSync(resolve(process.cwd(), "src/components/connected-manager/projects-manager.tsx"), "utf8");
    const barber = readFileSync(resolve(process.cwd(), "src/lib/barber-server.ts"), "utf8");
    expect(manager).toContain('.order("created_at", { ascending: false })');
    expect(barber).toContain('.order("created_at", { ascending: false })');
  });
});
