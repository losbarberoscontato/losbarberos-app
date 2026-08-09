# Chart Account Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed the PDF chart safely for every new barbershop and replace the empty chart of the authorized tenant.

**Architecture:** Store the global 42-row chart in `default_chart_account_templates`. An organization-insert trigger uses a tenant-scoped, idempotent seed function; an ungranted maintenance function performs replacement only when no financial entry references the current chart.

**Tech Stack:** PostgreSQL/Supabase migrations, pgTAP, Vitest.

## Global Constraints

- `chart_of_accounts` stays tenant-scoped with `organization_id` and composite parent FK.
- Financial entries and ledgers are never deleted or reassigned.
- Migration is incremental; remote application requires explicit authorization.
- No deploy, GitHub push, or credential output.

---

### Task 1: Add global template and safe provisioning

**Files:**
- Create: `supabase/migrations/202608090002_chart_account_templates.sql`
- Test: `tests/integrations/chart-account-template-migration.test.ts`

- [ ] Write a failing contract test that requires global template storage, 42 PDF codes, organization trigger, seed function, replacement guard, and revoked browser execution.
- [ ] Run `npm.cmd test -- tests/integrations/chart-account-template-migration.test.ts` and confirm the migration file is missing.
- [ ] Add template rows, idempotent tenant seed, parent resolution, organization trigger, and maintenance replacement function.
- [ ] Run the focused contract test and confirm it passes.

### Task 2: Prove database behavior

**Files:**
- Modify: `supabase/tests/001_database_invariants.sql`
- Modify: `tests/integrations/chart-account-template-migration.test.ts`

- [ ] Add pgTAP assertions that both test organizations receive 42 accounts, preserve 12/30 nature counts, resolve `1.1` under `1`, and reject replacement after a financial entry reference exists.
- [ ] Run the focused Vitest contract test and SQL validation available in this workspace.

### Task 3: Apply and verify the authorized tenant import

**Files:**
- Modify: none beyond migration and tests.

- [ ] Recheck migration state plus exactly three unused plans in `Barbearia Central`.
- [ ] Push only migration `202608090002` to the linked Supabase project.
- [ ] Invoke replacement for the uniquely matched authorized tenant.
- [ ] Query only aggregate/account-code evidence: 42 rows, 12 revenue, 30 expense, roots `1` and `2`, resolved parent counts, zero legacy names.

### Task 4: Validate and hand off

**Files:**
- Modify: none beyond prior tasks.

- [ ] Run `npm.cmd run verify`.
- [ ] Run `git diff --check`.
- [ ] Commit local migration, tests, and docs; merge only to local `main` after merged-tree test verification.
