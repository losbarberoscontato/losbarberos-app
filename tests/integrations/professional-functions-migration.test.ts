import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260919135448_professional_functions_catalog.sql",
  "utf8",
);

describe("professional functions catalog migration", () => {
  it("creates organization-scoped function names with case-insensitive uniqueness", () => {
    expect(migration).toContain("create table public.professional_functions");
    expect(migration).toContain("organization_id uuid not null references public.organizations");
    expect(migration).toContain("char_length(btrim(name)) between 2 and 80");
    expect(migration).toContain("unique index professional_functions_name_per_organization");
    expect(migration).toContain("lower(btrim(name))");
  });

  it("restricts CRUD and Data API access to authenticated organization owners", () => {
    expect(migration).toContain("alter table public.professional_functions enable row level security");
    expect(migration).toContain("public.is_organization_owner(organization_id)");
    expect(migration).toContain("grant select, insert on public.professional_functions to authenticated");
    expect(migration).not.toMatch(/grant .*public\.professional_functions to anon/i);
  });
});
