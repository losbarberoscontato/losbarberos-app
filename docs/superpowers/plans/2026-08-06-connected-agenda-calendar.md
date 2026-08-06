# Connected Agenda Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render Supabase appointments in the same day, week and month calendar experience as the demo and move creation into the approved modal.

**Architecture:** Add pure calendar projection helpers, extend the tenant-scoped agenda loader with appointment item snapshots, and replace the connected list markup with calendar views that retain existing mutations. Reuse established global demo calendar/modal classes and add only connected-specific styles where real-data behavior requires them.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase, Vitest, Testing Library.

## Global Constraints

- Connected UI must never import or render demo records.
- All queries remain scoped by `organization_id`.
- Appointment creation and transitions keep existing RPCs.
- Slots are fixed to 15-minute boundaries.
- No remote migration or deployment in this task.

---

### Task 1: Calendar projections

**Files:**
- Create: `src/components/connected-manager/agenda-calendar.ts`
- Test: `tests/ui/agenda-calendar.test.ts`

**Interfaces:**
- Produces: `dateKeyInTimezone`, `shiftDateKey`, `weekDateKeys`, `monthCells`, `appointmentGeometry`.

- [ ] Write failing tests with literal date, week, month and pixel-position expectations.
- [ ] Run `npm.cmd test -- tests/ui/agenda-calendar.test.ts --run` and confirm failure.
- [ ] Implement timezone-safe pure helpers.
- [ ] Run the focused test and confirm pass.

### Task 2: Real appointment labels

**Files:**
- Modify: `src/components/connected-manager/types.ts`
- Modify: `src/components/connected-manager/server.ts`
- Modify: `tests/ui/manager-connected.test.tsx`

**Interfaces:**
- Produces: `AppointmentItemRecord` and `appointmentItems` in `loadAgendaData`.

- [ ] Add a failing connected UI fixture requiring a real service snapshot label.
- [ ] Extend the tenant-scoped loader query for `appointment_items`.
- [ ] Pass complete fixture data and confirm the focused test passes.

### Task 3: Connected calendar and detail actions

**Files:**
- Modify: `src/components/connected-manager/agenda-manager.tsx`
- Modify: `src/components/connected-manager/connected-manager.module.css`
- Test: `tests/ui/manager-connected.test.tsx`

**Interfaces:**
- Consumes: calendar helpers and `appointmentItems`.
- Produces: functional day/week/month views, professional/status filters and detail drawer.

- [ ] Add failing interaction tests for date navigation, view switching and appointment detail.
- [ ] Implement day grid with real barber columns and appointment geometry.
- [ ] Implement week grouping and month counts; month-day click switches to day view.
- [ ] Preserve status transitions, confirmation, rescheduling and cancellation in the detail surface.
- [ ] Run focused UI tests.

### Task 4: Connected creation modal

**Files:**
- Modify: `src/components/connected-manager/agenda-manager.tsx`
- Modify: `src/components/connected-manager/connected-manager.module.css`
- Test: `tests/ui/manager-connected.test.tsx`

**Interfaces:**
- Preserves: `create_manual_appointment`, client lookup/quick creation and 15-minute validation.

- [ ] Add a failing test proving Novo agendamento opens a dialog instead of an inline form.
- [ ] Render the approved modal structure with split date/time inputs.
- [ ] Convert date/time to the existing tenant-timezone ISO contract.
- [ ] Keep client selection, service/package selection and out-of-schedule reason.
- [ ] Run focused UI tests.

### Task 5: Verification and visual comparison

**Files:**
- Modify only if verification exposes a defect.

- [ ] Run `npm.cmd run verify`.
- [ ] Open connected and demo agendas locally and compare day layout and creation modal.
- [ ] Run `git diff --check` and review the final diff.
- [ ] Commit locally without including `next-env.d.ts`.
