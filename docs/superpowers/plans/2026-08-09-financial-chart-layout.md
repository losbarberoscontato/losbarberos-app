# Financial Chart Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Organize chart accounts into collapsed Receitas and Despesas columns with hierarchical, code-aware ordering.

**Architecture:** Keep data retrieval and Supabase RPCs unchanged. Add a pure chart-account ordering helper in the cash manager module, then render each nature in an independent collapsible panel. The existing create/edit form consumes the same ordered, same-nature list for `Conta superior`.

**Tech Stack:** Next.js 16, React, TypeScript, Vitest, Testing Library, CSS Modules.

## Global Constraints

- Do not add migrations, change financial data, deploy, push, or write remotely.
- Keep demo mutations blocked from Supabase.
- Keep existing edit/inactivate/reactivate actions.
- Use PT-BR labels and responsive existing manager styles.

---

### Task 1: Specify and test chart ordering

**Files:**
- Modify: `tests/ui/cash-manager.test.tsx`
- Modify: `src/components/connected-manager/cash-manager.tsx`

**Interfaces:**
- Produces: `buildChartAccountTree(items: ChartAccountRecord[]): Array<ChartAccountRecord & { depth: number }>`.
- Consumes: `ChartAccountRecord.id`, `parent_id`, `code`, `name`, and `kind`.

- [ ] **Step 1: Write the failing test**

```tsx
render(<CashManager {...props} section="catalogs" />);
fireEvent.click(screen.getByRole("button", { name: "Mostrar planos de receitas" }));
expect(screen.getByText("1 · Serviços")).toBeInTheDocument();
expect(screen.getByText("1.2 · Corte")).toBeInTheDocument();
expect(screen.getByText("1.10 · Barba")).toBeInTheDocument();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- tests/ui/cash-manager.test.tsx`

Expected: FAIL because the collapsed column and code-aware hierarchy do not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
function compareChartAccounts(a: ChartAccountRecord, b: ChartAccountRecord) {
  const aSegments = (a.code ?? "").split(".").map(Number);
  const bSegments = (b.code ?? "").split(".").map(Number);
  for (let index = 0; index < Math.max(aSegments.length, bSegments.length); index += 1) {
    const difference = (aSegments[index] ?? -1) - (bSegments[index] ?? -1);
    if (difference) return difference;
  }
  return a.name.localeCompare(b.name, "pt-BR");
}

export function buildChartAccountTree(items: ChartAccountRecord[]) {
  const children = new Map<string | null, ChartAccountRecord[]>();
  items.forEach((item) => children.set(item.parent_id, [...(children.get(item.parent_id) ?? []), item]));
  const visit = (parentId: string | null, depth: number) => (children.get(parentId) ?? []).sort(compareChartAccounts).flatMap((item) => [{ ...item, depth }, ...visit(item.id, depth + 1)]);
  return visit(null, 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm.cmd test -- tests/ui/cash-manager.test.tsx`

Expected: PASS, including existing CashManager tests.

### Task 2: Render two collapsible nature columns

**Files:**
- Modify: `src/components/connected-manager/cash-manager.tsx`
- Modify: `tests/ui/cash-manager.test.tsx`

**Interfaces:**
- Consumes: `buildChartAccountTree` output.
- Produces: `ChartAccountColumns` with independent `REVENUE` and `EXPENSE` visibility state.

- [ ] **Step 1: Write the failing test**

```tsx
render(<CashManager {...props} section="catalogs" />);
expect(screen.getByRole("button", { name: "Mostrar planos de receitas" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "Mostrar planos de despesas" })).toBeInTheDocument();
expect(screen.queryByText("1 · Serviços")).not.toBeInTheDocument();
fireEvent.click(screen.getByRole("button", { name: "Mostrar planos de despesas" }));
expect(screen.getByText("2 · Estrutura")).toBeInTheDocument();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- tests/ui/cash-manager.test.tsx`

Expected: FAIL because all accounts render in one always-visible list.

- [ ] **Step 3: Write minimal implementation**

```tsx
<div className={styles.chartColumns}>
  <ChartAccountColumn kind="REVENUE" title="Receitas" />
  <ChartAccountColumn kind="EXPENSE" title="Despesas" />
</div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm.cmd test -- tests/ui/cash-manager.test.tsx`

Expected: PASS with independent toggle behavior and code labels.

### Task 3: Keep parent selection ordered and verify presentation

**Files:**
- Modify: `src/components/connected-manager/cash-manager.tsx`
- Modify: `tests/ui/cash-manager.test.tsx`

**Interfaces:**
- Consumes: `buildChartAccountTree` to create the existing parent options.
- Produces: parent choices restricted to active accounts of the selected nature.

- [ ] **Step 1: Write the failing test**

```tsx
render(<CashManager {...props} section="catalogs" />);
expect(screen.getByRole("option", { name: "1 · Serviços" })).toBeInTheDocument();
expect(screen.queryByRole("option", { name: "2 · Estrutura" })).not.toBeInTheDocument();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- tests/ui/cash-manager.test.tsx`

Expected: FAIL because the parent selector currently mixes account natures.

- [ ] **Step 3: Write minimal implementation**

```tsx
const [chartKind, setChartKind] = useState<ChartAccountRecord["kind"]>(editingChart?.kind ?? "REVENUE");
const parentOptions = buildChartAccountTree(chartAccounts.filter((item) => item.active && item.kind === chartKind));
```

- [ ] **Step 4: Run focused UI tests and typecheck**

Run: `npm.cmd test -- tests/ui/cash-manager.test.tsx`

Run: `npm.cmd run typecheck`

Expected: both commands exit 0.

### Task 4: Verify integration

**Files:**
- Modify: no new production files.

- [ ] **Step 1: Run full validation**

Run: `npm.cmd test`

Run: `npm.cmd run lint`

Run: `npm.cmd run typecheck`

Run: `npm.cmd run build`

Expected: all commands exit 0.

- [ ] **Step 2: Inspect the local demo route**

Open: `/gestor/financeiro/cadastros` without Supabase configuration.

Expected: two responsive collapsed columns, code labels, hierarchy, and preserved action buttons.
