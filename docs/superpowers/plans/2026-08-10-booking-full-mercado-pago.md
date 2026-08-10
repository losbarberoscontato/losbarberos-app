# Booking and Full Mercado Pago Payment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let linked clients book by barber or date within 15 days and complete either full Mercado Pago checkout or pay-at-counter according to barbershop policy.

**Architecture:** Extend organization configuration additively with branding and a tenant-wide `REQUIRED`/`OPTIONAL` policy. Keep current appointment/payment tables, but make new customer bookings use only `FULL` or `COUNTER`, enforce horizon and policy in PostgreSQL, and expose aggregate date availability through one RPC. Existing Mercado Pago OAuth, checkout and signed webhook remain the provider path.

**Tech Stack:** PostgreSQL/Supabase RPCs and Storage, Next.js 16.3, React 19, TypeScript, Mercado Pago Checkout Pro/OAuth/webhooks, Vitest, Testing Library, Playwright.

## Global Constraints

- `payment_transactions` remains payment source of truth.
- Redirect never confirms payment; only signed webhook can capture/confirm.
- New client bookings never use `DEPOSIT`; historical deposit columns and rows remain intact.
- Slots remain 15 minutes; horizon is today through today plus 15 days inclusive in organization timezone.
- `REQUIRED` cannot operate without connected Mercado Pago; `OPTIONAL` permits `COUNTER`.
- Demo never invokes Supabase or Mercado Pago.
- No wallet, credit or balance behavior.
- Do not apply linked migrations, push or deploy without explicit authorization.

---

### Task 1: Branding and payment-policy schema

**Files:**
- Create: `supabase/migrations/202608100002_client_branding_payment_policy.sql`
- Create: `tests/integrations/client-payment-policy-migration.test.ts`
- Modify: `supabase/tests/001_database_invariants.sql`

**Interfaces:**
- Produces: enum `customer_online_payment_policy` with `OPTIONAL`, `REQUIRED`.
- Adds: `organizations.customer_online_payment_policy`, `organizations.logo_path`, `organizations.operational_phone_e164`.
- Produces: public Storage bucket `organization-branding` with tenant-owner write and public read.
- Extends: `get_public_booking_context` with `logo_path`, `customer_online_payment_policy`, and `mercado_pago_connected`.

- [ ] **Step 1: Write failing migration contract test**

```ts
expect(sql).toContain("create type public.customer_online_payment_policy");
expect(sql).toContain("customer_online_payment_policy");
expect(sql).toContain("logo_path");
expect(sql).toContain("organization-branding");
expect(sql).toContain("get_public_booking_context");
expect(sql).not.toContain("drop column deposit_bps");
```

- [ ] **Step 2: Run red test**

Run: `npm.cmd test -- tests/integrations/client-payment-policy-migration.test.ts`

Expected: FAIL because migration is absent.

- [ ] **Step 3: Implement additive migration**

Default existing organizations to `OPTIONAL`. Add checks for E.164 operational number and organization-owned branding paths of form `<organization_id>/logo.<extension>`. Create storage policies that derive organization id from first path segment and require `is_organization_owner` for insert/update/delete.

Public booking context returns only public fields and a boolean connection state; never return Mercado Pago external account ids or token metadata.

- [ ] **Step 4: Add SQL invariants**

Prove default `OPTIONAL`, reject `REQUIRED` activation through save RPC when no connected merchant exists, permit public logo read, and deny cross-tenant upload/update.

- [ ] **Step 5: Run migration tests**

Run: `npm.cmd test -- tests/integrations/client-payment-policy-migration.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit policy schema**

```bash
git add supabase/migrations/202608100002_client_branding_payment_policy.sql supabase/tests/001_database_invariants.sql tests/integrations/client-payment-policy-migration.test.ts
git commit -m "feat(settings): add client payment policy and branding"
```

---

### Task 2: Connected settings for logo, public link and payment policy

**Files:**
- Modify: `src/components/connected-manager/types.ts`
- Modify: `src/components/connected-manager/server.ts`
- Modify: `src/components/connected-manager/settings-manager.tsx`
- Modify: `src/components/connected-manager/connected-manager.module.css`
- Modify: `src/components/settings-view.tsx`
- Modify: `tests/ui/manager-connected.test.tsx`
- Create: `tests/ui/settings-payment-policy.test.tsx`

**Interfaces:**
- Extends `OrganizationRecord` with `customer_online_payment_policy`, `logo_path`, `operational_phone_e164`.
- Produces: `uploadOrganizationLogo(file: File)` behavior using `organization-branding/<organizationId>/logo.<ext>`.

- [ ] **Step 1: Write failing settings tests**

Assert connected settings contains public-link copy action, logo upload, policy selector, and no “Sinal (%)”. Assert `REQUIRED` is disabled with explanation when merchant status is not `CONNECTED`.

```tsx
expect(screen.queryByLabelText("Sinal (%)")).not.toBeInTheDocument();
expect(screen.getByLabelText("Pagamento online")).toHaveValue("OPTIONAL");
expect(screen.getByRole("button", { name: "Copiar link" })).toBeInTheDocument();
```

- [ ] **Step 2: Run red settings tests**

Run: `npm.cmd test -- tests/ui/settings-payment-policy.test.tsx tests/ui/manager-connected.test.tsx`

Expected: FAIL because controls are absent.

- [ ] **Step 3: Implement safe save and upload UI**

Replace direct `organizations.update` for policy-sensitive fields with `save_organization_client_settings` RPC. Validate logo MIME to PNG/JPEG/WebP, max 2 MiB, and browser-decodable image before upload. Store only path; derive public URL through Supabase Storage client. Copy `${window.location.origin}/b/${slug}`.

Demo settings mirrors controls locally and clearly labels integrations as simulated; no Supabase calls.

- [ ] **Step 4: Run UI tests and typecheck**

Run: `npm.cmd test -- tests/ui/settings-payment-policy.test.tsx tests/ui/manager-connected.test.tsx`

Expected: PASS.

Run: `npm.cmd run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit settings UI**

```bash
git add src/components/connected-manager/types.ts src/components/connected-manager/server.ts src/components/connected-manager/settings-manager.tsx src/components/connected-manager/connected-manager.module.css src/components/settings-view.tsx tests/ui/settings-payment-policy.test.tsx tests/ui/manager-connected.test.tsx
git commit -m "feat(settings): configure full online payment"
```

---

### Task 3: Database-enforced 15-day availability and date aggregation

**Files:**
- Create: `supabase/migrations/202608100003_client_booking_full_payment.sql`
- Create: `tests/integrations/client-booking-full-payment-migration.test.ts`
- Modify: `supabase/tests/001_database_invariants.sql`

**Interfaces:**
- Replaces compatible body of `get_available_slots` with 15-day maximum.
- Produces: `get_available_slots_for_date(p_organization_slug text, p_local_date date, p_selections jsonb) returns jsonb`.
- Extends: `create_appointment_hold` to atomically return `HELD` for `FULL` and `CONFIRMED` for permitted `COUNTER`.

- [ ] **Step 1: Write failing migration test**

```ts
expect(sql).toContain("get_available_slots_for_date");
expect(sql).toContain("+ 15");
expect(sql).toContain("customer_online_payment_policy");
expect(sql).toContain("p_payment_mode = 'COUNTER'");
expect(sql).toContain("deposit_bps_snapshot");
expect(sql).not.toContain("+ 180");
```

- [ ] **Step 2: Run red migration test**

Run: `npm.cmd test -- tests/integrations/client-booking-full-payment-migration.test.ts`

Expected: FAIL because migration does not exist.

- [ ] **Step 3: Implement horizon and aggregate availability**

Use `(now() at time zone v_org.timezone)::date` as local today. Both slot RPCs reject dates outside `[today, today + 15]`. Aggregate RPC iterates only active compatible barbers and returns:

```json
{
  "duration_minutes": 35,
  "total_cents": 6500,
  "options": [
    { "barber_id": "uuid", "barber_name": "Diego", "starts_at": "timestamptz", "ends_at": "timestamptz" }
  ]
}
```

Sort options by `starts_at`, then `barber_name`.

- [ ] **Step 4: Implement atomic FULL/COUNTER creation**

For customer callers:

```sql
-- FULL: require connected merchant, insert HELD with hold_expires_at.
-- COUNTER: require policy OPTIONAL, insert CONFIRMED with hold_expires_at null.
-- DEPOSIT: reject with "customer deposit payments are disabled".
-- Every new row snapshots deposit_bps_snapshot = 0 and deposit_required_cents_snapshot = 0.
```

Keep exclusion constraint behavior and existing manager/manual contracts. Return shape includes `status`, `payment_mode`, `amount_due_now_cents`; `COUNTER` returns amount due now zero.

- [ ] **Step 5: Add SQL invariant scenarios**

Prove today and day 15 accepted, day 16 rejected, organization timezone used, `COUNTER` rejected under `REQUIRED`, `FULL` rejected when merchant disconnected, `COUNTER` immediately confirmed under `OPTIONAL`, and concurrent overlap still raises `23P01`.

- [ ] **Step 6: Run focused migration test**

Run: `npm.cmd test -- tests/integrations/client-booking-full-payment-migration.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit booking contracts**

```bash
git add supabase/migrations/202608100003_client_booking_full_payment.sql supabase/tests/001_database_invariants.sql tests/integrations/client-booking-full-payment-migration.test.ts
git commit -m "feat(booking): enforce full payment policy and horizon"
```

---

### Task 4: Client API and date-option model

**Files:**
- Modify: `src/components/connected-client/types.ts`
- Modify: `src/components/connected-client/api.ts`
- Modify: `src/components/connected-client/format.ts`
- Modify: `tests/ui/client-connected-api.test.tsx`
- Modify: `tests/ui/client-connected.test.tsx`

**Interfaces:**
- Adds `PublicOrganization.customer_online_payment_policy`, `mercado_pago_connected`, `logo_path`.
- Adds `AvailableDateOption { barber_id, barber_name, starts_at, ends_at }`.
- Produces: `getAvailableSlotsForDate(supabase, { organizationSlug, localDate, selections })`.
- Changes `createAppointmentHold` payment mode to `FULL | COUNTER` and status to `HELD | CONFIRMED`.

- [ ] **Step 1: Write failing format/API tests**

```ts
expect(dateOptions("America/Sao_Paulo", 16, now)).toHaveLength(16);
expect(rpc).toHaveBeenCalledWith("get_available_slots_for_date", expect.objectContaining({
  p_organization_slug: "tenant-a",
  p_local_date: "2026-08-10",
}));
```

Add API test proving `COUNTER` sends exact enum and client never sends `DEPOSIT`.

- [ ] **Step 2: Run focused tests and verify red state**

Run: `npm.cmd test -- tests/ui/client-connected-api.test.tsx tests/ui/client-connected.test.tsx`

Expected: FAIL on absent date API/new types.

- [ ] **Step 3: Implement types, formatting and API calls**

Make default `dateOptions` count 16. Keep ISO local dates deterministic. Parse aggregate RPC without trusting browser-computed price/duration. Update error mapping for day-16, policy-required and disconnected merchant errors.

- [ ] **Step 4: Run focused tests**

Run: `npm.cmd test -- tests/ui/client-connected-api.test.tsx tests/ui/client-connected.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit API model**

```bash
git add src/components/connected-client/types.ts src/components/connected-client/api.ts src/components/connected-client/format.ts tests/ui/client-connected-api.test.tsx tests/ui/client-connected.test.tsx
git commit -m "feat(booking): expose barber-date availability"
```

---

### Task 5: Booking UI by barber or date with full/counter choice

**Files:**
- Modify: `src/components/connected-client/booking.tsx`
- Modify: `src/components/connected-client/connected-client.module.css`
- Modify: `tests/ui/client-connected.test.tsx`
- Modify: `tests/e2e/client-connected.spec.ts`

**Interfaces:**
- Consumes aggregate date options and organization payment policy.
- Produces only `FULL` or `COUNTER` booking requests.

- [ ] **Step 1: Write failing UI scenarios**

Cover:

```text
REQUIRED + connected -> only “Pagar agora” and checkout CTA.
OPTIONAL + connected -> “Pagar agora” and “Pagar no dia”.
OPTIONAL + disconnected -> only “Pagar no dia”.
REQUIRED + disconnected -> blocking reconnection message, no booking submit.
By date -> each selectable row includes time and barber name.
No UI text contains “sinal” or wallet balance.
```

- [ ] **Step 2: Run red UI tests**

Run: `npm.cmd test -- tests/ui/client-connected.test.tsx`

Expected: FAIL because current UI exposes DEPOSIT and barber-first only.

- [ ] **Step 3: Refactor booking steps**

Keep service/audience choice. Add mode selector `BARBER | DATE`. In DATE mode fetch one aggregate response and select `(barberId, startsAt)` together. Review shows barber, date/time, item, total and exact payment choice.

For `COUNTER`, call appointment RPC and route directly to reservations on `CONFIRMED`. For `FULL`, create order and checkout exactly as existing flow. Remove all deposit calculations and copy.

- [ ] **Step 4: Add E2E assertions**

Connected fixture tests select audience, service, mode DATE, one option, and verify full/counter controls according to seeded policy. Demo E2E verifies visual simulation performs no network calls to Supabase functions.

- [ ] **Step 5: Run UI and E2E tests**

Run: `npm.cmd test -- tests/ui/client-connected.test.tsx`

Expected: PASS.

Run: `npx.cmd playwright test tests/e2e/client-connected.spec.ts --config tests/e2e/client-connected.config.ts`

Expected: public tests PASS; connected tests PASS only with seeded local environment, otherwise explicit SKIP.

- [ ] **Step 6: Commit booking UI**

```bash
git add src/components/connected-client/booking.tsx src/components/connected-client/connected-client.module.css tests/ui/client-connected.test.tsx tests/e2e/client-connected.spec.ts
git commit -m "feat(client): choose barber-date and full payment"
```

---

### Task 6: Full-payment cancellation, late webhook and refund review

**Files:**
- Modify: `supabase/migrations/202608100003_client_booking_full_payment.sql`
- Modify: `supabase/tests/001_database_invariants.sql`
- Modify: `supabase/functions/mercado-pago-webhook/index.ts`
- Modify: `supabase/functions/_shared/mercado-pago-refunds.ts`
- Modify: `src/components/connected-client/reservations.tsx`
- Modify: `tests/integrations/status.test.ts`
- Create: `tests/integrations/full-payment-refund.test.ts`
- Modify: `tests/ui/client-connected.test.tsx`

**Interfaces:**
- Extends `cancel_appointment` behavior: before deadline creates automatic full refund; after deadline creates manual `REQUIRES_ACTION` review for net paid amount.
- Produces idempotent late-payment refund order keyed by provider payment id.

- [ ] **Step 1: Write failing cancellation/refund tests**

```ts
expect(mapMercadoPagoPaymentStatus("approved")).toBe("CAPTURED");
// SQL contract contains late-payment idempotency key and REQUIRES_ACTION outside deadline.
// Reservations copy never promises wallet credit.
```

Mock webhook twice with same approved payment after expired hold and assert one transaction registration and one refund/review request.

- [ ] **Step 2: Run red tests**

Run: `npm.cmd test -- tests/integrations/full-payment-refund.test.ts tests/integrations/status.test.ts tests/ui/client-connected.test.tsx`

Expected: FAIL on missing late-payment behavior.

- [ ] **Step 3: Implement cancellation policy**

Inside deadline, enqueue Mercado Pago refund for full `net_paid_cents`. Outside deadline, cancel appointment and create `REFUND` payment order in `REQUIRES_ACTION` without calling provider automatically. For `COUNTER` with no capture, create no refund order.

Late approved payment records append-only capture first, then creates deterministic refund order `late-payment-refund:<external_transaction_id>`. It never updates appointment back to confirmed.

- [ ] **Step 4: Update reservation UI**

Show exact states: refund initiated, refund under manual review, no online payment, or provider issue. Remove wallet/credit language from demo and connected components.

- [ ] **Step 5: Run focused tests**

Run: `npm.cmd test -- tests/integrations/full-payment-refund.test.ts tests/integrations/status.test.ts tests/ui/client-connected.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit refund handling**

```bash
git add supabase/migrations/202608100003_client_booking_full_payment.sql supabase/tests/001_database_invariants.sql supabase/functions/mercado-pago-webhook/index.ts supabase/functions/_shared/mercado-pago-refunds.ts src/components/connected-client/reservations.tsx tests/integrations/full-payment-refund.test.ts tests/integrations/status.test.ts tests/ui/client-connected.test.tsx
git commit -m "fix(payments): handle full-payment cancellation safely"
```

---

### Task 7: Booking/payment verification gate

**Files:**
- Modify: `docs/qa.md`
- Modify: `HANDOFF.md`

- [ ] **Step 1: Run focused suite**

Run: `npm.cmd test -- tests/integrations/client-payment-policy-migration.test.ts tests/integrations/client-booking-full-payment-migration.test.ts tests/integrations/full-payment-refund.test.ts tests/ui/settings-payment-policy.test.tsx tests/ui/client-connected-api.test.tsx tests/ui/client-connected.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run full gates**

```text
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Expected: all exit 0.

- [ ] **Step 3: Run local HTTP smoke**

Smoke `/cliente`, `/cliente/agendar`, `/gestor/configuracoes`, and `/b/<fixture-slug>` against local production server; each expected HTTP 200 or documented redirect.

- [ ] **Step 4: Document proof boundary**

Mark Mercado Pago sandbox checkout/webhook/refund and Supabase linked migrations `NAO VALIDADO` until user authorizes external configuration and writes.

- [ ] **Step 5: Commit evidence docs**

```bash
git add docs/qa.md HANDOFF.md
git commit -m "docs: record full-payment booking validation"
```
