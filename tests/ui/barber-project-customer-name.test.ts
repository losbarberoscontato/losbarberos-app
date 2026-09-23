import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/lib/barber-server.ts"), "utf8");

describe("barber project cards", () => {
  it("loads the customer relation under the name consumed by the Kanban card", () => {
    expect(source).toContain('customer:customers(full_name)');
  });

  it("preserves a customer relation returned as an object or as an embedded array", () => {
    expect(source).toContain("Array.isArray(item.customer)");
    expect(source).toContain("item.customer[0] ?? null : item.customer");
  });
});
