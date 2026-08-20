import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260820214642_client_last_organization.sql"),
  "utf8",
);

describe("última barbearia do cliente", () => {
  it("persiste preferência global sem expor vínculo cross-tenant", () => {
    expect(migration).toContain("last_organization_id uuid");
    expect(migration).toContain("references public.organizations(id) on delete set null");
    expect(migration).toContain("c.auth_user_id = v_user_id");
    expect(migration).toContain("c.active");
    expect(migration).toContain("c.merged_into_customer_id is null");
  });

  it("lista preferência e restringe alteração ao cliente autenticado", () => {
    expect(migration).toContain("'is_last', o.id = ca.last_organization_id");
    expect(migration).toContain("set_my_last_client_organization");
    expect(migration).toContain("client organization not linked");
    expect(migration).toContain("grant execute on function public.set_my_last_client_organization(text) to authenticated");
  });
});
