# WhatsApp Embedded Signup and Reminder Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each barbershop connect its own WhatsApp Business account and send idempotent confirmations, up to two configured reminders, barber notifications and secure web actions.

**Architecture:** Replace the single global sender assumption with a tenant connection record whose secret token stays in Vault. Meta Embedded Signup establishes WABA/phone ownership; existing outbox, attempts, webhook events and customer action tokens remain the delivery backbone. Configured reminder rules drive enqueue jobs, while action buttons open a tokenized web flow rather than performing irreversible work from a single click.

**Tech Stack:** Supabase PostgreSQL/Vault/Edge Functions, Meta WhatsApp Cloud API and Embedded Signup, Next.js 16.3 App Router, React 19, TypeScript, Vitest, provider mocks.

## Global Constraints

- Each barbershop owns its WABA and phone number.
- Tokens never enter browser, public tables, logs, commits or chat.
- Up to two active reminder rules per organization.
- Only approved structured templates; no marketing consent side effect.
- WhatsApp failure never rolls back a valid appointment.
- Barber phone is optional; missing/invalid/without consent falls back to organization operational number.
- Confirm/cancel/reschedule actions use opaque, expiring, recipient-bound, single-use tokens and web confirmation.
- External Meta configuration is a hard gate: pause and request exact non-secret IDs/secrets through approved local configuration path when reached.
- Do not configure Meta, deploy functions, push or apply remote migrations without explicit authorization.

---

### Task 1: Tenant WhatsApp connection and reminder schema

**Files:**
- Create: `supabase/migrations/202608100004_whatsapp_tenant_automation.sql`
- Create: `tests/integrations/whatsapp-tenant-migration.test.ts`
- Modify: `supabase/tests/001_database_invariants.sql`

**Interfaces:**
- Produces: `whatsapp_business_connections(organization_id, waba_id, phone_number_id, access_token_secret_id, status, connected_at, disconnected_at)`.
- Produces: `whatsapp_reminder_rules(id, organization_id, position, enabled, offset_minutes, template_key, language_code)` with maximum two positions.
- Adds: `barbers.phone_e164`, `barbers.whatsapp_operational_consent_at`.
- Produces: `save_whatsapp_reminder_rules(p_organization_id uuid, p_rules jsonb) returns jsonb`.
- Produces: `get_whatsapp_connection_status(p_organization_id uuid) returns jsonb` without secret ids.

- [ ] **Step 1: Write failing migration contract test**

```ts
expect(sql).toContain("create table public.whatsapp_business_connections");
expect(sql).toContain("create table public.whatsapp_reminder_rules");
expect(sql).toContain("position between 1 and 2");
expect(sql).toContain("access_token_secret_id");
expect(sql).toContain("save_whatsapp_reminder_rules");
```

- [ ] **Step 2: Run red test**

Run: `npm.cmd test -- tests/integrations/whatsapp-tenant-migration.test.ts`

Expected: FAIL because migration is absent.

- [ ] **Step 3: Implement tenant-safe tables, RLS and RPCs**

Store only Vault secret UUID, never token text. Connection status enum: `PENDING`, `CONNECTED`, `REAUTH_REQUIRED`, `DISCONNECTED`. Enforce unique `waba_id` and `phone_number_id` ownership. Reminder offsets must be between 180 minutes and 30 days and unique per organization. Template keys must be non-empty and locale constrained to approved format.

- [ ] **Step 4: Add SQL invariants**

Prove organization A cannot read B connection, manager cannot select secret id, max two rules enforced, duplicate offsets rejected, barber notification falls back when phone/consent missing, and tenant cancellation never affects another outbox.

- [ ] **Step 5: Run migration test**

Run: `npm.cmd test -- tests/integrations/whatsapp-tenant-migration.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit schema**

```bash
git add supabase/migrations/202608100004_whatsapp_tenant_automation.sql supabase/tests/001_database_invariants.sql tests/integrations/whatsapp-tenant-migration.test.ts
git commit -m "feat(whatsapp): add tenant connection and reminders"
```

---

### Task 2: Embedded Signup state and callback contracts

**Files:**
- Create: `supabase/functions/whatsapp-embedded-signup-start/index.ts`
- Create: `supabase/functions/whatsapp-embedded-signup-callback/index.ts`
- Create: `supabase/functions/_shared/whatsapp-embedded-signup.ts`
- Modify: `supabase/config.toml`
- Create: `tests/integrations/whatsapp-embedded-signup.test.ts`
- Modify: `tests/security/client-boundary.test.ts`

**Interfaces:**
- Produces start response `{ configurationId: string, state: string }` where state is opaque/single-use.
- Callback consumes Meta authorization code plus hashed state and persists Vault token reference through service role RPC.
- Required external names remain Edge-only: `WHATSAPP_META_APP_ID`, `WHATSAPP_META_APP_SECRET`, `WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID`, `WHATSAPP_GRAPH_API_VERSION`.

- [ ] **Step 1: Write failing provider/state tests**

Mock Graph API and assert state hash is stored, raw state returned once, callback rejects expired/reused state, token exchange body never enters logs, and public source scan contains no secret values.

```ts
expect(result.state).toMatch(/^[A-Za-z0-9_-]{43}$/u);
expect(fetch).toHaveBeenCalledWith(expect.stringContaining("graph.facebook.com"), expect.objectContaining({ method: "POST" }));
```

- [ ] **Step 2: Run red tests**

Run: `npm.cmd test -- tests/integrations/whatsapp-embedded-signup.test.ts tests/security/client-boundary.test.ts`

Expected: FAIL because functions/shared helper are absent.

- [ ] **Step 3: Implement start and callback**

Reuse opaque token helpers and safe return-path normalization. Start requires active organization owner. Callback validates code/state, exchanges short-lived credentials using pinned Graph API version, resolves WABA/phone id, stores token in Vault, subscribes app to WABA webhooks idempotently, and writes only connection status/public IDs.

Never return token to browser. Provider errors use retry classification and sanitized codes.

- [ ] **Step 4: Register Edge Functions**

Add function entries to `supabase/config.toml` with JWT verification appropriate to start; callback validates state and provider signature/code flow rather than trusting organization id from browser.

- [ ] **Step 5: Run focused tests**

Run: `npm.cmd test -- tests/integrations/whatsapp-embedded-signup.test.ts tests/security/client-boundary.test.ts`

Expected: PASS with mocked provider; external Meta remains `NAO VALIDADO`.

- [ ] **Step 6: Commit Embedded Signup code**

```bash
git add supabase/functions/whatsapp-embedded-signup-start supabase/functions/whatsapp-embedded-signup-callback supabase/functions/_shared/whatsapp-embedded-signup.ts supabase/config.toml tests/integrations/whatsapp-embedded-signup.test.ts tests/security/client-boundary.test.ts
git commit -m "feat(whatsapp): add embedded signup flow"
```

---

### Task 3: Tenant-aware sender and webhook routing

**Files:**
- Modify: `supabase/functions/_shared/whatsapp.ts`
- Modify: `supabase/functions/whatsapp-send-outbox/index.ts`
- Modify: `supabase/functions/whatsapp-webhook/index.ts`
- Create: `tests/integrations/whatsapp-tenant-routing.test.ts`
- Modify: `tests/integrations/status.test.ts`

**Interfaces:**
- Replaces `defaultWhatsAppSender()` with `whatsappSenderForOrganization(organizationId)` returning `{ accessToken, phoneNumberId, graphVersion }` server-side only.
- Webhook resolves organization by unique `phone_number_id` in `whatsapp_business_connections`.

- [ ] **Step 1: Write failing tenant-routing tests**

Assert two claimed jobs use different phone ids/tokens, missing connection marks job `FAILED` retryable without cross-tenant fallback, webhook phone A cannot mutate organization B, and duplicate delivery callback stays idempotent.

- [ ] **Step 2: Run red routing tests**

Run: `npm.cmd test -- tests/integrations/whatsapp-tenant-routing.test.ts tests/integrations/status.test.ts`

Expected: FAIL because sender remains global.

- [ ] **Step 3: Implement per-organization sender resolution**

Load Vault token only after outbox lease claim identifies `organization_id`. Never include token in thrown messages or stored provider responses. Preserve unknown-send handling: network uncertainty becomes `SEND_UNKNOWN`, not blind retry.

- [ ] **Step 4: Implement webhook routing**

Verify Meta signature over raw body first. Resolve tenant by phone id, then process statuses, opt-out and inbound action metadata under that organization. Unknown phone id records sanitized operational failure and performs no customer lookup.

- [ ] **Step 5: Run tests**

Run: `npm.cmd test -- tests/integrations/whatsapp-tenant-routing.test.ts tests/integrations/status.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit routing**

```bash
git add supabase/functions/_shared/whatsapp.ts supabase/functions/whatsapp-send-outbox/index.ts supabase/functions/whatsapp-webhook/index.ts tests/integrations/whatsapp-tenant-routing.test.ts tests/integrations/status.test.ts
git commit -m "fix(whatsapp): route sends and webhooks by tenant"
```

---

### Task 4: Configurable confirmation and reminder outbox

**Files:**
- Modify: `supabase/migrations/202608100004_whatsapp_tenant_automation.sql`
- Modify: `supabase/functions/maintenance-jobs/index.ts`
- Create: `tests/integrations/whatsapp-reminders.test.ts`
- Modify: `supabase/tests/001_database_invariants.sql`

**Interfaces:**
- Replaces fixed `appointment_reminder_0700` enqueue behavior with active reminder rules.
- Produces deterministic keys `appointment:<id>:v<version>:reminder:<rule-id>`.
- Produces customer confirmation, barber notification and organization fallback events.

- [ ] **Step 1: Write failing reminder tests**

Cover zero, one and two enabled rules; exact offsets; timezone/DST; appointment version changes; customer opt-out; canceled appointment; barber phone/consent; fallback number; and duplicate job execution.

- [ ] **Step 2: Run red reminder tests**

Run: `npm.cmd test -- tests/integrations/whatsapp-reminders.test.ts`

Expected: FAIL because enqueue function is fixed to 07:00.

- [ ] **Step 3: Implement configurable enqueue RPC**

Join confirmed appointments to active rules and organization timezone. Enqueue only when `scheduled_at <= now()` and appointment remains future. Payload uses approved template key, locale and normalized parameters. Confirmation trigger enqueues customer plus barber/fallback rows independently; one failure never suppresses the other.

- [ ] **Step 4: Keep maintenance job contract stable**

`maintenance-jobs` continues invoking `enqueue_due_whatsapp_reminders`; only SQL behavior changes. Preserve `FOR UPDATE SKIP LOCKED` in claims and current job-name allowlist.

- [ ] **Step 5: Run tests**

Run: `npm.cmd test -- tests/integrations/whatsapp-reminders.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit reminders**

```bash
git add supabase/migrations/202608100004_whatsapp_tenant_automation.sql supabase/functions/maintenance-jobs/index.ts supabase/tests/001_database_invariants.sql tests/integrations/whatsapp-reminders.test.ts
git commit -m "feat(whatsapp): schedule configurable reminders"
```

---

### Task 5: Secure web actions for confirm, cancel and reschedule

**Files:**
- Create: `src/app/cliente/acao/[token]/page.tsx`
- Create: `src/components/connected-client/whatsapp-action.tsx`
- Modify: `src/components/connected-client/connected-client.module.css`
- Modify: `supabase/migrations/202608100004_whatsapp_tenant_automation.sql`
- Create: `tests/ui/whatsapp-action.test.tsx`
- Create: `tests/integrations/whatsapp-action-migration.test.ts`

**Interfaces:**
- Produces: `get_customer_action_context(p_token text) returns jsonb` with sanitized appointment preview.
- Produces: `apply_customer_action(p_token text, p_action customer_action_kind, p_reason text) returns jsonb`.
- Adds action `CONFIRM_ATTENDANCE`; keeps `REQUEST_CANCEL`, `CONFIRM_CANCEL`, `RESCHEDULE` compatibility.

- [ ] **Step 1: Write failing action tests**

```tsx
expect(screen.getByRole("button", { name: "Confirmar presença" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "Cancelar agendamento" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "Solicitar reagendamento" })).toBeInTheDocument();
```

SQL tests prove raw token is never stored, used/expired/wrong-recipient token applies no state, cancel requires reason and second confirmation, and reschedule creates manual notification rather than changing `service_period`.

- [ ] **Step 2: Run red action tests**

Run: `npm.cmd test -- tests/ui/whatsapp-action.test.tsx tests/integrations/whatsapp-action-migration.test.ts`

Expected: FAIL because route/RPCs are absent.

- [ ] **Step 3: Implement tokenized RPCs**

Hash raw token with SHA-256 inside function and lock token/appointment rows. Context RPC reveals only organization name, appointment date/time, barber and service snapshots. Apply RPC consumes token in same transaction as status event/outbox insertion.

`CONFIRM_ATTENDANCE` adds idempotent status event without changing `CONFIRMED`. `REQUEST_CANCEL` issues a second short-lived token. `CONFIRM_CANCEL` calls `cancel_appointment`. `RESCHEDULE` enqueues request to operational number and returns app link; it does not mutate appointment.

- [ ] **Step 4: Implement mobile action page**

Page handles loading, valid preview, expired/used state, cancellation reason and two-step confirmation. Do not require a Supabase login because possession of recipient-bound single-use token is the capability; never expose token in analytics/logs.

- [ ] **Step 5: Run focused tests**

Run: `npm.cmd test -- tests/ui/whatsapp-action.test.tsx tests/integrations/whatsapp-action-migration.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit web actions**

```bash
git add src/app/cliente/acao/[token]/page.tsx src/components/connected-client/whatsapp-action.tsx src/components/connected-client/connected-client.module.css supabase/migrations/202608100004_whatsapp_tenant_automation.sql tests/ui/whatsapp-action.test.tsx tests/integrations/whatsapp-action-migration.test.ts
git commit -m "feat(whatsapp): add secure appointment actions"
```

---

### Task 6: Manager setup, reminder configuration and barber fallback

**Files:**
- Modify: `src/components/connected-manager/settings-manager.tsx`
- Modify: `src/components/connected-manager/team-manager.tsx`
- Modify: `src/components/connected-manager/server.ts`
- Modify: `src/components/connected-manager/types.ts`
- Modify: `src/components/connected-manager/connected-manager.module.css`
- Create: `tests/ui/whatsapp-settings.test.tsx`
- Modify: `tests/ui/manager-connected.test.tsx`

**Interfaces:**
- Consumes connection status RPC and reminder save RPC.
- Produces Embedded Signup launch button using Facebook JS SDK configuration id, never app secret.
- Produces barber operational phone and explicit notification-consent controls.

- [ ] **Step 1: Write failing manager tests**

Assert disconnected state shows “Conectar WhatsApp”, connected state shows WABA/phone ids only, exactly two reminder editors maximum, template and offset validation, no token input, and barber fallback explanation.

- [ ] **Step 2: Run red settings tests**

Run: `npm.cmd test -- tests/ui/whatsapp-settings.test.tsx tests/ui/manager-connected.test.tsx`

Expected: FAIL because tenant setup/reminder controls do not exist.

- [ ] **Step 3: Implement manager controls**

Start Embedded Signup through server-generated state/config id. Save reminder rules atomically through RPC. Offer approved template keys returned by backend configuration, not arbitrary text. Team form stores normalized E.164 phone and consent timestamp; clearing consent disables direct sends and activates operational fallback.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npm.cmd test -- tests/ui/whatsapp-settings.test.tsx tests/ui/manager-connected.test.tsx`

Expected: PASS.

Run: `npm.cmd run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit manager configuration**

```bash
git add src/components/connected-manager/settings-manager.tsx src/components/connected-manager/team-manager.tsx src/components/connected-manager/server.ts src/components/connected-manager/types.ts src/components/connected-manager/connected-manager.module.css tests/ui/whatsapp-settings.test.tsx tests/ui/manager-connected.test.tsx
git commit -m "feat(settings): configure tenant WhatsApp automation"
```

---

### Task 7: External Meta configuration gate

**Files:**
- Modify: `.env.example`
- Modify: `docs/integrations.md`
- Modify: `docs/qa.md`

- [ ] **Step 1: Stop before external configuration**

Ask user for authorization and the following setup through local secrets/configuration, never chat plaintext:

```text
Meta App ID
Meta App Secret
Embedded Signup Configuration ID
Pinned Graph API version
Production/staging callback URL registration
Approved template names and locales
Meta test WABA and phone number access
```

Do not continue to live/sandbox connection until supplied and authorized.

- [ ] **Step 2: Document environment names without values**

Add placeholders to `.env.example` and exact Meta App Review/callback/template checklist to `docs/integrations.md`.

- [ ] **Step 3: Commit configuration documentation**

```bash
git add .env.example docs/integrations.md docs/qa.md
git commit -m "docs: define WhatsApp external configuration gate"
```

---

### Task 8: WhatsApp local verification gate

**Files:**
- Modify: `HANDOFF.md`

- [ ] **Step 1: Run focused suite**

Run: `npm.cmd test -- tests/integrations/whatsapp-tenant-migration.test.ts tests/integrations/whatsapp-embedded-signup.test.ts tests/integrations/whatsapp-tenant-routing.test.ts tests/integrations/whatsapp-reminders.test.ts tests/integrations/whatsapp-action-migration.test.ts tests/ui/whatsapp-action.test.tsx tests/ui/whatsapp-settings.test.tsx tests/security/client-boundary.test.ts`

Expected: PASS with provider mocks.

- [ ] **Step 2: Run full gates**

```text
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Expected: all exit 0.

- [ ] **Step 3: Run local HTTP smoke**

Smoke `/cliente/acao/<invalid-token>` and `/gestor/configuracoes`; invalid token route must return safe page without data leakage.

- [ ] **Step 4: Record evidence boundary**

Mark provider mocks/local UI as validated. Mark Meta App Review, Embedded Signup, approved template send, delivery webhook and production as `NAO VALIDADO` until external gate completes.

- [ ] **Step 5: Commit handoff**

```bash
git add HANDOFF.md
git commit -m "docs: record WhatsApp automation validation"
```
