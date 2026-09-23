import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/lib/barber-server.ts"), "utf8");

describe("barber project cards", () => {
  it("loads the customer relation under the name consumed by the Kanban card", () => {
    expect(source).toContain('customer:customers(full_name)');
  });
});
