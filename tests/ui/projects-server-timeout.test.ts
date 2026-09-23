import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/components/connected-manager/projects-server.ts"), "utf8");

describe("projects commission loading", () => {
  it("uses the filtered project commission RPC instead of the global view", () => {
    expect(source).toContain('rpc("get_project_commission_details"');
    expect(source).not.toContain('from("commission_service_details").select("*")');
  });
});
