import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260829123936_preserve_organization_slug_aliases.sql"),
  "utf8",
).toLowerCase();

describe("organization slug aliases migration", () => {
  it("preserva slugs anteriores, bloqueia reuso e não expõe aliases por RLS", () => {
    expect(sql).toContain("create table public.organization_slug_aliases");
    expect(sql).toContain("on delete set null");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("force row level security");
    expect(sql).toContain("organization slug is permanently reserved");
    expect(sql).toContain("insert into public.organization_slug_aliases (slug, organization_id)");
    expect(sql).toContain("select 'barbershop', o.id");
    expect(sql).toContain("where o.slug = 'cutclub'");
  });

  it("resolve slug atual ou legado apenas para contexto público e devolve slug canônico", () => {
    expect(sql).toContain("create or replace function public.get_public_booking_context");
    expect(sql).toContain("lower(btrim(p_organization_slug))");
    expect(sql).toContain("left join public.organization_slug_aliases");
    expect(sql).toContain("'slug', o.slug");
    expect(sql).toContain("grant execute on function public.get_public_booking_context(text) to anon, authenticated");
  });
});
