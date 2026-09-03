import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const accessPage = readFileSync(resolve(process.cwd(), "src/app/barbeiro/page.tsx"), "utf8");
const server = readFileSync(resolve(process.cwd(), "src/lib/barber-server.ts"), "utf8");
const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260903172810_barber_multi_organization_access.sql"), "utf8");

describe("barber multi-organization access", () => {
  it("shows a connection choice only when more than one active organization is available", () => {
    expect(accessPage).toContain("access.organizations.length === 1");
    expect(accessPage).toContain("BarberConnectionScreen");
    expect(accessPage).toContain("BarberDisconnectedScreen");
  });

  it("requires an explicit tenant slug before loading operational routes", () => {
    expect(server).toContain("const normalizedSlug = normalizeTenantSlug(slug)");
    expect(server).toContain("if (!normalizedSlug) return null");
  });

  it("keeps the disconnected account profile self-scoped", () => {
    expect(migration).toContain("profiles_self_insert");
    expect(migration).toContain("profile-avatars");
    expect(migration).toContain("(storage.foldername(name))[1] = (select auth.uid()::text)");
  });
});
