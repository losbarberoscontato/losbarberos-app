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
const invariantSql = readFileSync(
  resolve(process.cwd(), "supabase/tests/001_database_invariants.sql"),
  "utf8",
).toLowerCase();

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

  it("accepts E.164 plus prefixes without ambiguous backslash escaping", () => {
    const upsertSql = functionSql("upsert_my_client_account");

    expect(normalizedSql).toContain(
      "phone_e164 text not null check (phone_e164 ~ '^[+][1-9][0-9]{7,14}$')",
    );
    expect(upsertSql).toContain(
      "p_phone_e164 !~ '^[+][1-9][0-9]{7,14}$'",
    );
    expect(normalizedSql).not.toContain("'^\\\\+'");
  });

  it("requires confirmed auth email before creating or updating the global account", () => {
    const upsertSql = functionSql("upsert_my_client_account");

    expect(upsertSql).toContain("from auth.users");
    expect(upsertSql).toContain("email_confirmed_at is not null");
    expect(upsertSql).toContain("errcode = '42501'");
    expect(upsertSql).toContain("email confirmation required");
    expect(invariantSql).toContain("select plan(120)");
    expect(invariantSql).toContain(
      "unconfirmed auth email cannot upsert global client account",
    );
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

    expect(normalizedSql).toContain(
      "grant select on table public.client_accounts to authenticated",
    );
    expect(normalizedSql).not.toContain(
      "grant select, update on table public.client_accounts to authenticated",
    );
    expect(normalizedSql).not.toContain(
      "create policy client_accounts_self_update",
    );
  });

  it("permits canonical writes only inside transaction-scoped trusted paths", () => {
    const protectSql = functionSql("protect_linked_customer_canonical_fields");
    const legacyProtectSql = functionSql("protect_customer_self_service_fields");
    const syncSql = functionSql("sync_client_account_to_linked_customers");
    const claimSql = functionSql("claim_my_existing_customer");

    expect(normalizedSql).toContain(
      "create table app_private.client_identity_write_context",
    );
    expect(protectSql).toContain("app_private.client_identity_write_context");
    expect(protectSql).toContain("pg_backend_pid()");
    expect(protectSql).toContain("txid_current()");
    expect(legacyProtectSql).toContain("app_private.client_identity_write_context");
    expect(legacyProtectSql).toContain("pg_backend_pid()");
    expect(legacyProtectSql).toContain("txid_current()");
    expect(syncSql).toContain("insert into app_private.client_identity_write_context");
    expect(syncSql).toContain("delete from app_private.client_identity_write_context");
    expect(claimSql).toContain("insert into app_private.client_identity_write_context");
    expect(claimSql).toContain("delete from app_private.client_identity_write_context");
    expect(normalizedSql).toContain(
      "revoke all on app_private.client_identity_write_context from public, anon, authenticated",
    );
  });

  it("serializes tenant identity linking before locking customer rows", () => {
    const linkSql = functionSql("link_my_client_to_organization");
    const claimSql = functionSql("claim_my_existing_customer");
    const tenantLockSeed = "202608100001";

    expect(linkSql).toMatch(
      new RegExp(
        `pg_advisory_xact_lock\\s*\\(\\s*hashtextextended\\s*\\(\\s*'client_identity:'\\s*\\|\\|\\s*v_organization\\.id::text\\s*,\\s*${tenantLockSeed}\\s*\\)\\s*\\)`,
        "u",
      ),
    );
    expect(claimSql).toMatch(
      new RegExp(
        `pg_advisory_xact_lock\\s*\\(\\s*hashtextextended\\s*\\(\\s*'client_identity:'\\s*\\|\\|\\s*p_organization_id::text\\s*,\\s*${tenantLockSeed}\\s*\\)\\s*\\)`,
        "u",
      ),
    );

    for (const body of [linkSql, claimSql]) {
      const accountSource = body.indexOf("from public.client_accounts");
      const accountLock = body.indexOf("for update;", accountSource);
      const organizationValidation = body.indexOf(
        "organization_accepts_new_bookings",
      );
      const tenantLock = body.indexOf("pg_advisory_xact_lock");
      const firstCustomerSource = body.indexOf("from public.customers");
      const firstCustomerLock = body.indexOf("for update;", firstCustomerSource);

      expect(accountSource).toBeGreaterThanOrEqual(0);
      expect(accountLock).toBeGreaterThanOrEqual(0);
      expect(organizationValidation).toBeGreaterThan(accountLock);
      expect(tenantLock).toBeGreaterThan(organizationValidation);
      expect(firstCustomerSource).toBeGreaterThan(tenantLock);
      expect(firstCustomerLock).toBeGreaterThan(tenantLock);
    }
  });

  it("covers exact claims, canonical sync and direct evidence spoofing in pgTAP", () => {
    expect(invariantSql).toContain(
      "exact one verified candidate requires explicit claim",
    );
    expect(invariantSql).toContain(
      "exact verified candidate claim links canonical identity",
    );
    expect(invariantSql).toContain(
      "linked customer follows global profile update",
    );
    expect(invariantSql).toContain(
      "client cannot spoof verified phone evidence directly",
    );
    expect(invariantSql).toContain(
      "client cannot spoof terms acceptance evidence directly",
    );
  });
});
