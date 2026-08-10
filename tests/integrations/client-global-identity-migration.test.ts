import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608100001_client_global_identity.sql",
  ),
  "utf8",
);
const normalizedSql = sql.toLowerCase();

function functionSql(name: string) {
  const marker = `create or replace function public.${name}`;
  const start = normalizedSql.indexOf(marker);
  expect(start, `${name} must exist`).toBeGreaterThanOrEqual(0);
  const next = normalizedSql.indexOf("create or replace function public.", start + marker.length);
  return normalizedSql.slice(start, next === -1 ? undefined : next);
}

describe("global client identity migration", () => {
  it("adds self-owned identity and explicit tenant links", () => {
    expect(normalizedSql).toContain("create table public.client_accounts");
    expect(normalizedSql).toContain(
      "create or replace function public.link_my_client_to_organization",
    );
    expect(normalizedSql).toContain(
      "create or replace function public.list_my_client_organizations",
    );
    expect(normalizedSql).toContain("auth.uid()");
    expect(normalizedSql).toContain("organization_id, auth_user_id");
    expect(normalizedSql).not.toContain("drop table public.customers");
  });

  it("requires verified contact before offering a tenant customer claim", () => {
    const linkSql = functionSql("link_my_client_to_organization");
    const claimSql = functionSql("claim_my_existing_customer");

    expect(normalizedSql).toContain("phone_verified_at");
    expect(normalizedSql).toMatch(
      /create unique index client_accounts_verified_phone_unique[\s\S]*where phone_verified_at is not null/u,
    );
    expect(linkSql).toContain("phone_confirmed_at");
    expect(linkSql).toContain("email_confirmed_at");
    expect(claimSql).toContain("phone_confirmed_at");
    expect(claimSql).toContain("email_confirmed_at");
    expect(normalizedSql).toContain(
      "create or replace function public.claim_my_existing_customer",
    );
    expect(linkSql).toContain("claim_required");
    expect(linkSql).toContain("review_required");
    expect(claimSql).toContain("linked");
    expect(claimSql).toContain("review_required");
    expect(linkSql).not.toMatch(/c\.full_name\s*=/u);
    expect(claimSql).not.toMatch(/c\.full_name\s*=/u);
  });

  it("keeps reviews private and blocks manager canonical-field changes", () => {
    expect(normalizedSql).toContain("create table public.customer_link_reviews");
    expect(normalizedSql).toContain("status in ('open', 'approved', 'rejected')");
    expect(normalizedSql).toContain("alter table public.customer_link_reviews force row level security");
    expect(normalizedSql).not.toMatch(
      /create policy [^\n]+ on public\.customer_link_reviews[\s\S]{0,160}requester_auth_user_id\s*=\s*auth\.uid\(\)/u,
    );
    expect(normalizedSql).toContain(
      "create or replace function public.protect_linked_customer_canonical_fields",
    );
    expect(normalizedSql).toContain("linked customer canonical fields are client-controlled");
  });

  it("uses security-definer RPCs with fixed search paths and least privilege", () => {
    for (const name of [
      "upsert_my_client_account",
      "link_my_client_to_organization",
      "list_my_client_organizations",
      "claim_my_existing_customer",
    ]) {
      const body = functionSql(name);
      expect(body).toContain("security definer");
      expect(body).toContain("set search_path = public, pg_temp");
      expect(normalizedSql).toContain(`revoke all on function public.${name}`);
      expect(normalizedSql).toContain(`grant execute on function public.${name}`);
    }
  });
});
