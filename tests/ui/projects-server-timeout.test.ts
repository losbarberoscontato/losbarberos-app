import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/components/connected-manager/projects-server.ts"), "utf8");

describe("projects commission loading", () => {
  it("scopes commission view reads to loaded projects", () => {
    expect(source).toContain('.in("project_id", projectIds)');
    expect(source).not.toContain('from("commission_service_details").select("*")');
  });
});
