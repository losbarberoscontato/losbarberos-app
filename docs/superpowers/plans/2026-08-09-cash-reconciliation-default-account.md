# Cash Reconciliation and Default Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clarify Cash movement payment state, add date filters and appointment details, and seed a default physical cash account for every tenant.

**Architecture:** Enrich appointment cash activity in the server loader with payment-summary, appointment-item, and barber data. Keep React filtering local and serializable. Add one additive migration for account description plus global template/seed/trigger and default manual-counter mapping.

**Tech Stack:** Next.js App Router, React, TypeScript, Vitest, Supabase PostgreSQL/RLS/RPC.

## Global Constraints

- Money stays integer cents; payment ledger remains source of truth.
- Every financial row keeps `organization_id`; no cross-tenant reference.
- Ledgers are append-only; migration must not edit payment transactions or appointments.
- Demo stays local and never writes Supabase.
- Migration remains local until explicit remote authorization.

---

### Task 1: Cash movement regression tests and client presentation

**Files:**
- Modify: `tests/ui/cash-manager.test.tsx`
- Modify: `src/components/connected-manager/cash-manager.tsx`
- Modify: `src/components/connected-manager/connected-manager.module.css`

**Interfaces:**
- Consumes: enriched `AppointmentCashActivityRecord` fields `display_description` and `financial_status`.
- Produces: labelled desktop columns and inclusive local date filters.

- [ ] **Step 1: Write failing UI tests**

```tsx
expect(screen.getByRole("columnheader", { name: "Situação do pagamento" })).toBeInTheDocument();
expect(screen.getByText("Corte clássico · Profissional: Alef")).toBeInTheDocument();
expect(screen.getByText("Recebido")).toBeInTheDocument();
expect(screen.queryByText("Aguardando conciliação")).not.toBeInTheDocument();
```

Add a movement dated `2026-08-09`, set both date inputs to that date, and assert it remains while a `2026-08-10` row is hidden.

- [ ] **Step 2: Verify RED**

Run: `npm.cmd test -- tests/ui/cash-manager.test.tsx`

Expected: FAIL because headers, enriched description, `Recebido`, and date inputs do not exist.

- [ ] **Step 3: Implement minimal presentation**

Add start/end state, date-key helper using `America/Sao_Paulo`, and inclusive filters (`due_date` for entries; transaction date for activity). Render one shared header grid and appointment columns. Map `PAID` to `Recebido`; render account `Não vinculada` only when mapping is absent.

- [ ] **Step 4: Verify GREEN**

Run: `npm.cmd test -- tests/ui/cash-manager.test.tsx`

Expected: PASS.

### Task 2: Enrich Cash server data

**Files:**
- Modify: `src/components/connected-manager/types.ts`
- Modify: `src/components/connected-manager/server.ts`
- Modify: `src/app/gestor/financeiro/[section]/page.tsx`
- Test: `tests/ui/cash-manager.test.tsx`

**Interfaces:**
- Produces: `AppointmentCashActivityRecord.display_description: string` and `financial_status: string`.

- [ ] **Step 1: Extend test fixture with intended server fields**

```ts
appointmentActivity: [{ ..., display_description: "Corte clássico · Profissional: Alef", financial_status: "PAID" }]
```

- [ ] **Step 2: Implement server enrichment**

Load appointment summaries, appointments, item snapshots, and barbers for the current organization. Build item names ordered by `position`, append barber display name, and use fallbacks `Atendimento` and `Profissional não informado`. Keep only primitive serializable fields.

- [ ] **Step 3: Verify client tests**

Run: `npm.cmd test -- tests/ui/cash-manager.test.tsx`

Expected: PASS with no Supabase call from demo flow.

### Task 3: Default account migration and account description

**Files:**
- Create: `supabase/migrations/202608090003_cash_default_account.sql`
- Modify: `supabase/tests/001_database_invariants.sql`
- Create: `tests/integrations/cash-default-account-migration.test.ts`

**Interfaces:**
- Produces: `seed_default_financial_accounts(uuid) returns integer` and organization trigger.
- Produces: `save_financial_account(..., p_description text default null)`.

- [ ] **Step 1: Write failing migration contract test**

```ts
expect(sql).toContain("add column description text");
expect(sql).toContain("Caixa Físico");
expect(sql).toContain("seed_default_financial_accounts");
expect(sql).toContain("MANUAL");
expect(sql).toContain("COUNTER");
```

- [ ] **Step 2: Verify RED**

Run: `npm.cmd test -- tests/integrations/cash-default-account-migration.test.ts`

Expected: FAIL because migration does not exist.

- [ ] **Step 3: Implement additive migration**

Add nullable checked description, global template, owner-safe seed, insert trigger, idempotent backfill, and mapping insert with `on conflict do nothing`. Replace the account-save RPC signature safely, regrant only the new signature, and preserve existing account data and mappings.

- [ ] **Step 4: Add pgTAP assertions and verify GREEN**

Assert description column, default account values, account count per new tenant, default `MANUAL`/`COUNTER` mapping, no duplicate on repeat seed, and no authenticated seed execution. Run focused Vitest test.

### Task 4: Account description UI and full verification

**Files:**
- Modify: `src/components/connected-manager/cash-manager.tsx`
- Modify: `src/components/connected-manager/types.ts`
- Modify: `src/app/gestor/financeiro/[section]/page.tsx`
- Modify: `HANDOFF.md`
- Modify: `IMPLEMENTATION_PROMPT.md`

- [ ] **Step 1: Write failing UI assertion**

```tsx
expect(screen.getByLabelText("Descrição da conta")).toBeInTheDocument();
```

- [ ] **Step 2: Implement field and RPC parameter**

Render editable description in account form, pass `p_description`, load description in Cash data, and show it on account card when present. Demo account includes same physical-cash description.

- [ ] **Step 3: Run full validation**

Run: `npm.cmd run verify`

Expected: ESLint, TypeScript, Vitest, and Next build pass.

- [ ] **Step 4: Run database tests when Docker is available**

Run: `npx.cmd supabase test db --linked supabase/tests/001_database_invariants.sql`

Expected: pgTAP assertions pass. If Docker is unavailable, report this as not validated; do not claim a pass.
