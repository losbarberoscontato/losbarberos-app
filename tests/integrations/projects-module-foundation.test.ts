import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260914014549_projects_module_foundation.sql",
  "utf8",
);

describe("projects module foundation migration", () => {
  it("registers the module, contract and default owner activation", () => {
    expect(migration).toContain("'projects'");
    expect(migration).toContain("julioheidenn@gmail.com");
    expect(migration).toContain("platform_module_contract_versions");
    expect(migration).toContain("accept_module_contract_and_enable");
  });

  it("records the 60-day reactivation window and expiry job", () => {
    expect(migration).toContain("data_retention_until");
    expect(migration).toContain("interval '60 days'");
    expect(migration).toContain("process_expired_project_module_retention");
    expect(migration).toContain("PENDING_DELETION");
    expect(migration).toContain("DELETED");
  });
});
