# Global Client Identity and Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one global client account that can explicitly link to multiple isolated barbershops through a dedicated email/password flow and mobile home.

**Architecture:** Add a self-owned `client_accounts` record keyed by `auth.users.id`, while retaining `customers` as the tenant-scoped operational relationship used by appointments. Security-definer RPCs own profile synchronization, explicit linking, verified-contact claims, and organization listing; client UI consumes these contracts through the existing connected-client provider.

**Tech Stack:** PostgreSQL/Supabase RLS and RPCs, Supabase Auth, Next.js 16.3 App Router, React 19, TypeScript 6, Zod 4, Vitest, Testing Library, Playwright.

## Global Constraints

- Money remains integer cents; percentages remain basis points.
- Every operational relationship remains scoped by `organization_id`; no cross-tenant read is allowed.
- Demo never writes to Supabase.
- Google OAuth, public search, wallet, balance, signal and subscriptions are out of scope.
- Use `npm.cmd` and `npx.cmd` on Windows.
- Do not push, deploy or apply remote migrations without explicit authorization.
- Read `node_modules/next/dist/docs/01-app/02-guides/authentication.md`, `redirecting.md`, and `01-app/03-api-reference/03-file-conventions/dynamic-routes.md` before changing App Router code.

---

### Task 1: Global client identity schema and tenant linking contracts

**Files:**
- Create: `supabase/migrations/202608100001_client_global_identity.sql`
- Create: `tests/integrations/client-global-identity-migration.test.ts`
- Modify: `supabase/tests/001_database_invariants.sql`

**Interfaces:**
- Produces: `client_accounts(auth_user_id, full_name, phone_e164, birth_date, terms_policy_version, terms_accepted_at)`.
- Produces: `upsert_my_client_account(p_full_name text, p_phone_e164 text, p_birth_date date, p_terms_policy_version text) returns uuid`.
- Produces: `link_my_client_to_organization(p_organization_slug text) returns jsonb`.
- Produces: `list_my_client_organizations() returns jsonb`.
- Produces: `claim_my_existing_customer(p_organization_id uuid, p_customer_id uuid) returns jsonb` with `LINKED` or `REVIEW_REQUIRED`.

- [ ] **Step 1: Write failing migration contract test**

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/202608100001_client_global_identity.sql"), "utf8");

describe("global client identity migration", () => {
  it("adds self-owned identity and explicit tenant links", () => {
    expect(sql).toContain("create table public.client_accounts");
    expect(sql).toContain("create or replace function public.link_my_client_to_organization");
    expect(sql).toContain("create or replace function public.list_my_client_organizations");
    expect(sql).toContain("auth.uid()");
    expect(sql).toContain("organization_id, auth_user_id");
    expect(sql).not.toContain("drop table public.customers");
  });
});
```

- [ ] **Step 2: Run focused test and verify red state**

Run: `npm.cmd test -- tests/integrations/client-global-identity-migration.test.ts`

Expected: FAIL because migration file does not exist.

- [ ] **Step 3: Create additive schema and RLS**

Implement `client_accounts` with self-only RLS and a unique verified phone candidate index that does not expose lookup publicly. Add `customer_link_reviews` for ambiguous claims with statuses `OPEN`, `APPROVED`, `REJECTED`; every row includes `organization_id`, candidate customer, requester UUID, reason and timestamps.

```sql
create table public.client_accounts (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone_e164 text not null,
  birth_date date,
  terms_policy_version text not null,
  terms_accepted_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

`link_my_client_to_organization` must lock the account and candidate rows, verify organization accepts customer onboarding, return the existing `(organization_id, auth_user_id)` customer idempotently, create a new tenant customer only after explicit call, and never match by name. Exact verified phone/email candidate matches return a confirmation payload; conflicting authenticated identities create `customer_link_reviews` instead of merging.

- [ ] **Step 4: Add database invariant scenarios**

Append pgTAP-style transaction cases proving:

```sql
-- user A can read/update only client_accounts row A
-- explicit link creates one customer for (organization, auth_user_id)
-- retry returns same customer id
-- same auth user can link to organization B without exposing A data
-- manager cannot overwrite linked canonical contact fields
-- tenant-only customer remains valid
-- ambiguous claim creates review and preserves both rows
```

- [ ] **Step 5: Run migration and database tests locally**

Run: `npm.cmd test -- tests/integrations/client-global-identity-migration.test.ts`

Expected: PASS.

If local Supabase is available, run: `npx.cmd supabase db reset --local` followed by repository SQL invariant command documented for the local stack. If Docker is unavailable, report SQL execution as `NAO VALIDADO`; do not substitute linked remote execution.

- [ ] **Step 6: Commit schema contracts**

```bash
git add supabase/migrations/202608100001_client_global_identity.sql supabase/tests/001_database_invariants.sql tests/integrations/client-global-identity-migration.test.ts
git commit -m "feat(customers): add global client identity links"
```

---

### Task 2: Safe client auth destinations and form validation

**Files:**
- Create: `src/lib/client-auth.ts`
- Create: `tests/domain/client-auth.test.ts`
- Modify: `src/app/auth/callback/route.ts`
- Modify: `tests/integrations/oauth-callback.test.ts`

**Interfaces:**
- Produces: `clientSignupSchema` with `fullName`, `phoneE164`, `email`, `password`, `birthDate`, `acceptedTerms`.
- Produces: `clientAuthDestination(input: { next?: string | null; slug?: string | null }): string`.
- Consumes: `normalizeSafeReturnPath` from `src/lib/integrations/state.ts`.

- [ ] **Step 1: Write failing destination and validation tests**

```ts
expect(clientAuthDestination({ next: "/cliente", slug: "barbearia-real" }))
  .toBe("/cliente?barbearia=barbearia-real");
expect(clientAuthDestination({ next: "https://evil.example", slug: "barbearia-real" }))
  .toBe("/cliente?barbearia=barbearia-real");
expect(clientSignupSchema.safeParse({
  fullName: "Ana Souza",
  phoneE164: "+5511999999999",
  email: "ana@example.com",
  password: "Senha#123",
  birthDate: "1990-02-10",
  acceptedTerms: true,
}).success).toBe(true);
```

- [ ] **Step 2: Run tests and verify missing-module failure**

Run: `npm.cmd test -- tests/domain/client-auth.test.ts tests/integrations/oauth-callback.test.ts`

Expected: FAIL because `src/lib/client-auth.ts` is absent.

- [ ] **Step 3: Implement Zod validation and destination allowlist**

Allow only `/cliente`, `/cliente/agendar`, `/cliente/reservas` and `/cliente/perfil`. Normalize slug with existing `normalizeTenantSlug`; reject schemes, backslashes, protocol-relative paths and unknown destinations. Password minimum is eight characters with letter, number and non-alphanumeric character.

- [ ] **Step 4: Update callback contract**

Add `/cliente` to callback destinations and preserve `barbearia` only through `clientAuthDestination`; keep manager/admin destinations unchanged. Do not accept arbitrary `next` from the browser.

- [ ] **Step 5: Run focused tests**

Run: `npm.cmd test -- tests/domain/client-auth.test.ts tests/integrations/oauth-callback.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit auth helpers**

```bash
git add src/lib/client-auth.ts src/app/auth/callback/route.ts tests/domain/client-auth.test.ts tests/integrations/oauth-callback.test.ts
git commit -m "feat(auth): preserve safe client tenant context"
```

---

### Task 3: Dedicated email/password client entry

**Files:**
- Create: `src/app/cliente/entrar/page.tsx`
- Create: `src/components/connected-client/auth-form.tsx`
- Modify: `src/components/connected-client/connected-client.module.css`
- Modify: `tests/ui/client-connected.test.tsx`

**Interfaces:**
- Consumes: `clientSignupSchema` and `clientAuthDestination`.
- Consumes: Supabase `signUp`, `signInWithPassword`, `resetPasswordForEmail`, and `resend`.
- Produces: `ClientAuthForm({ initialSlug, initialNext })`.

- [ ] **Step 1: Write failing UI tests**

Render `ClientAuthForm` with mocked browser client and assert separate tabs for Entrar/Criar conta, required name/phone/birth/terms fields during signup, no Google button, and email redirect containing encoded barbershop slug.

```tsx
expect(screen.getByRole("heading", { name: "Acesse sua barbearia" })).toBeInTheDocument();
expect(screen.queryByText("Continuar com Google")).not.toBeInTheDocument();
```

- [ ] **Step 2: Run UI test and verify red state**

Run: `npm.cmd test -- tests/ui/client-connected.test.tsx`

Expected: FAIL because auth form does not exist.

- [ ] **Step 3: Implement page and form**

Use client component for Supabase Auth calls. On signup, pass validated profile fields only as auth metadata needed to resume onboarding and set `emailRedirectTo` to the allowlisted callback. After confirmed signin, call `upsert_my_client_account`; do not create a tenant customer until explicit confirmation screen.

Recovery flow calls `resetPasswordForEmail` with an allowlisted callback. Re-send confirmation uses `supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo } })`. Error copy must not reveal whether another unrelated account exists beyond Supabase-safe generic messaging.

- [ ] **Step 4: Run UI and type tests**

Run: `npm.cmd test -- tests/ui/client-connected.test.tsx`

Expected: PASS.

Run: `npm.cmd run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit client entry**

```bash
git add src/app/cliente/entrar/page.tsx src/components/connected-client/auth-form.tsx src/components/connected-client/connected-client.module.css tests/ui/client-connected.test.tsx
git commit -m "feat(auth): add dedicated client email access"
```

---

### Task 4: Connected-client relationship context and explicit confirmation

**Files:**
- Modify: `src/components/connected-client/types.ts`
- Modify: `src/components/connected-client/api.ts`
- Modify: `src/components/connected-client/context.tsx`
- Modify: `src/components/connected-client/state.tsx`
- Modify: `src/app/b/[slug]/page.tsx`
- Modify: `tests/ui/client-connected-api.test.tsx`
- Modify: `tests/ui/client-connected.test.tsx`

**Interfaces:**
- Produces: `ClientAccount`, `ClientOrganization`, `ClientLinkResult` types.
- Produces: `getMyClientAccount`, `upsertMyClientAccount`, `listMyClientOrganizations`, `linkMyClientToOrganization` API functions.
- Extends provider with `account`, `organizations`, `linkStatus`, `confirmTenantLink()`, `switchTenant(slug)`.

- [ ] **Step 1: Write failing API contract tests**

```ts
expect(rpc).toHaveBeenCalledWith("link_my_client_to_organization", {
  p_organization_slug: "barbearia-real",
});
expect(rpc).toHaveBeenCalledWith("list_my_client_organizations");
```

Add provider test proving authenticated user sees “Entrar nesta barbearia” before children, retry returns same relation, and unauthenticated user gets link to `/cliente/entrar` preserving slug.

- [ ] **Step 2: Run focused tests and verify failures**

Run: `npm.cmd test -- tests/ui/client-connected-api.test.tsx tests/ui/client-connected.test.tsx`

Expected: FAIL on missing interfaces/actions.

- [ ] **Step 3: Implement API and provider state**

Replace Google-only `AuthPrompt` with route link to `/cliente/entrar`. Keep public context loading available before auth. Load global account and organization list after session; load tenant `customer` only when explicit relation exists. Confirmation invokes RPC once and reloads relation state.

Change `/b/[slug]` destination to `/cliente?barbearia=<slug>`. Do not create relationship in route handler.

- [ ] **Step 4: Run focused tests**

Run: `npm.cmd test -- tests/ui/client-connected-api.test.tsx tests/ui/client-connected.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit relationship context**

```bash
git add src/components/connected-client/types.ts src/components/connected-client/api.ts src/components/connected-client/context.tsx src/components/connected-client/state.tsx src/app/b/[slug]/page.tsx tests/ui/client-connected-api.test.tsx tests/ui/client-connected.test.tsx
git commit -m "feat(customers): require explicit barbershop relationship"
```

---

### Task 5: Mobile client home and barbershop switcher

**Files:**
- Create: `src/components/connected-client/home.tsx`
- Modify: `src/app/cliente/page.tsx`
- Modify: `src/components/connected-client/shell.tsx`
- Modify: `src/components/connected-client/connected-client.module.css`
- Modify: `tests/ui/client-connected.test.tsx`
- Modify: `tests/e2e/client-connected.spec.ts`

**Interfaces:**
- Consumes: provider `context`, `customer`, `organizations`, `switchTenant`, `signOut`.
- Produces: home CTA `/cliente/agendar?barbearia=<slug>` and confirmed switcher behavior.

- [ ] **Step 1: Write failing home/switcher tests**

Assert home renders organization name as primary heading, address, “Agendar”, no wallet/saldo copy, and menu choices only for linked organizations. Assert switch requires a confirmation action before context changes.

- [ ] **Step 2: Run tests and verify red state**

Run: `npm.cmd test -- tests/ui/client-connected.test.tsx`

Expected: FAIL because `/cliente` still redirects and home does not exist.

- [ ] **Step 3: Implement responsive home and hamburger navigation**

Keep bottom navigation for Agendar/Reservas/Perfil. Add home brand hierarchy and optional `logo_path` placeholder contract without uploading assets in this plan. On switch, display source and target organization names and clear tenant-specific cached customer/appointments before loading target.

- [ ] **Step 4: Update E2E route expectations**

```ts
await page.goto("/b/barbearia-do-bairro");
await expect(page).toHaveURL(/\/cliente\?barbearia=barbearia-do-bairro$/u);
```

Add mobile viewport assertion for visible organization heading and CTA when connected fixture exists.

- [ ] **Step 5: Run UI and E2E-safe tests**

Run: `npm.cmd test -- tests/ui/client-connected.test.tsx`

Expected: PASS.

Run: `npx.cmd playwright test tests/e2e/client-connected.spec.ts --config tests/e2e/client-connected.config.ts`

Expected: public alias test PASS; connected-only tests SKIP without seeded local Supabase.

- [ ] **Step 6: Commit home and switcher**

```bash
git add src/components/connected-client/home.tsx src/app/cliente/page.tsx src/components/connected-client/shell.tsx src/components/connected-client/connected-client.module.css tests/ui/client-connected.test.tsx tests/e2e/client-connected.spec.ts
git commit -m "feat(client): add tenant-aware mobile home"
```

---

### Task 6: Global profile editing and linked-manager restrictions

**Files:**
- Modify: `src/components/connected-client/profile.tsx`
- Modify: `src/components/connected-client/api.ts`
- Modify: `src/components/connected-manager/customers-manager.tsx`
- Modify: `src/components/connected-manager/server.ts`
- Modify: `src/components/connected-manager/types.ts`
- Modify: `tests/ui/client-connected.test.tsx`
- Modify: `tests/ui/manager-connected.test.tsx`

**Interfaces:**
- Consumes: `upsertMyClientAccount`.
- Produces: linked customers display canonical fields read-only to manager; tenant-only customers retain current edit form.

- [ ] **Step 1: Write failing client and manager tests**

Assert profile save calls global RPC once. Assert manager edit form disables canonical contact fields when `auth_user_id` exists and still permits notes/status actions. Extend `CustomerRecord` loader/type to include `auth_user_id` without exposing unrelated account data.

- [ ] **Step 2: Run focused tests and verify failures**

Run: `npm.cmd test -- tests/ui/client-connected.test.tsx tests/ui/manager-connected.test.tsx`

Expected: FAIL until new account contract is wired.

- [ ] **Step 3: Implement profile and manager behavior**

Profile email is sourced from authenticated user and email change remains Supabase Auth-managed. Save name/phone/birth through global RPC. Manager sees explanation “Dados controlados pelo cliente” and can edit only notes/active/inactivation fields for linked rows.

- [ ] **Step 4: Run focused tests and full client typecheck**

Run: `npm.cmd test -- tests/ui/client-connected.test.tsx tests/ui/manager-connected.test.tsx`

Expected: PASS.

Run: `npm.cmd run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit profile boundary**

```bash
git add src/components/connected-client/profile.tsx src/components/connected-client/api.ts src/components/connected-manager/customers-manager.tsx src/components/connected-manager/server.ts src/components/connected-manager/types.ts tests/ui/client-connected.test.tsx tests/ui/manager-connected.test.tsx
git commit -m "feat(customers): protect global client profile fields"
```

---

### Task 7: Identity/access verification gate

**Files:**
- Modify: `docs/qa.md`
- Modify: `HANDOFF.md`

**Interfaces:**
- Consumes all prior tasks; produces local validation evidence only.

- [ ] **Step 1: Run focused identity suite**

Run: `npm.cmd test -- tests/domain/client-auth.test.ts tests/integrations/client-global-identity-migration.test.ts tests/integrations/oauth-callback.test.ts tests/ui/client-connected-api.test.tsx tests/ui/client-connected.test.tsx tests/ui/manager-connected.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run full local gates**

Run separately:

```text
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Expected: all exit 0. Clear `.next` only if generated stale route types cause a confirmed false failure; preserve unrelated `next-env.d.ts` changes.

- [ ] **Step 3: Run HTTP smoke**

Start production server locally and run `curl.exe -sS --max-time 20 -o NUL -w "HTTP %{http_code}\n" http://localhost:3000/cliente/entrar`.

Expected: `HTTP 200`.

- [ ] **Step 4: Document exact evidence**

Record demo versus connected/local status. Mark Supabase linked migration, email delivery and production as `NAO VALIDADO` until separately authorized.

- [ ] **Step 5: Commit verification docs**

```bash
git add docs/qa.md HANDOFF.md
git commit -m "docs: record global client access validation"
```
