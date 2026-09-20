import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("projects archive migration", () => {
  it("adds a reversible archived status and secured RPC", async () => {
    const sql = await readFile(resolve(process.cwd(), "supabase/migrations/20260916132558_archive_project_status.sql"), "utf8");
    expect(sql).toContain("'ARCHIVED'");
    expect(sql).toContain("create function public.set_project_archive_status");
    expect(sql).toContain("grant execute on function public.set_project_archive_status");
    expect(sql).toContain("where status not in ('CLOSED', 'ARCHIVED')");
  });

  it("enforces case-insensitive title uniqueness for every project status", async () => {
    const sql = await readFile(resolve(process.cwd(), "supabase/migrations/20260916135109_projects_unique_name_all_statuses.sql"), "utf8");
    expect(sql).toContain("lower(btrim(name))");
    expect(sql).not.toContain("where status");
  });
});
