import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationFile = readdirSync("supabase/migrations").find((file) =>
  file.endsWith("_professional_function_assignment.sql"),
);
const migration = migrationFile
  ? readFileSync(`supabase/migrations/${migrationFile}`, "utf8")
  : "";

describe("professional function assignment migration", () => {
  it("adds an optional tenant-scoped function relation to barbers", () => {
    expect(migration).toMatch(/alter table public\.barbers[\s\S]*add column professional_function_id uuid/i);
    expect(migration).toMatch(/foreign key\s*\(professional_function_id,\s*organization_id\)/i);
    expect(migration).toMatch(/references public\.professional_functions\s*\(id,\s*organization_id\)/i);
  });
});
