import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "202608150001_client_public_links_and_branding.sql"),
  "utf8",
);

describe("links públicos e identidade da organização", () => {
  it("cria identificador de agendamento permanente e mantém fila existente", () => {
    expect(migration).toContain("booking_public_id uuid default gen_random_uuid()");
    expect(migration).toContain("organizations_booking_public_id_key");
    expect(migration).toContain("queue_public_id");
    expect(migration).toContain("where booking_public_id is null");
  });

  it("separa contato público das credenciais de provedor", () => {
    expect(migration).toContain("public_contact_phone_e164");
    expect(migration).not.toContain("EVOLUTION_API_KEY");
  });

  it("protege logo por organização e lista vínculos do cliente", () => {
    expect(migration).toContain("organization-logos");
    expect(migration).toContain("list_my_client_organizations");
    expect(migration).toContain("organization_memberships");
    expect(migration).toContain("get_public_booking_organization");
  });
});
