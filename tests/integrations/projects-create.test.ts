import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("projects create migration", () => {
  it("creates a project without bootstrapping an initial package", async () => {
    const sql = await readFile(resolve(process.cwd(), "supabase/migrations/20260916145602_create_project_without_initial_package.sql"), "utf8");
    expect(sql).toContain("create function public.create_project");
    expect(sql).toContain("insert into public.projects");
    expect(sql).toContain("insert into public.project_steps");
    expect(sql).not.toContain("insert into public.project_packages");
    expect(sql).toContain("grant execute on function public.create_project");
  });
});
