import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("projects edit migration", () => {
  it("updates project metadata and the initial package atomically", async () => {
    const sql = await readFile(resolve(process.cwd(), "supabase/migrations/20260916123833_update_project_with_initial_package.sql"), "utf8");
    expect(sql).toContain("create function public.update_project_with_initial_package");
    expect(sql).toContain("update public.projects");
    expect(sql).toContain("update public.project_packages");
    expect(sql).toContain("project update denied");
    expect(sql).toContain("grant execute on function public.update_project_with_initial_package");
  });
});
