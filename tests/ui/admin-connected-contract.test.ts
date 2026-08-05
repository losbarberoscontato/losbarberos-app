import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const serverSource = readFileSync("src/components/connected-admin/server.ts", "utf8");
const clientSource = readFileSync("src/components/connected-admin/control-plane.tsx", "utf8");

describe("platform admin data boundary", () => {
  it("consulta apenas control-plane sem PII comercial ou perfis", () => {
    expect(serverSource).toContain('.from("organizations")');
    expect(serverSource).toContain('.from("saas_subscriptions")');
    expect(serverSource).toContain('.from("organization_access_events")');
    expect(serverSource).not.toMatch(/\.from\(["'](?:customers|profiles|organization_memberships)["']\)/);
    expect(serverSource).not.toMatch(/created_by|actor_user_id|metadata|provider_event_id/);
  });

  it("muda acesso somente pela RPC auditada", () => {
    expect(clientSource).toContain('.rpc("set_platform_organization_access_status"');
    expect(clientSource).not.toMatch(/\.from\([^)]*\)\.(?:insert|update|upsert|delete)\(/);
    expect(clientSource).toContain("p_reason: reason.trim()");
  });
});
