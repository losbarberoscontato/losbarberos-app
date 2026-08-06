# Modal de clientes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Abrir criação e edição de clientes em modal padrão da Agenda.

**Architecture:** `CustomersManager` manterá estado de edição e persistência atual, trocando apenas a apresentação inline pelo par `modal-layer`/`form-modal` já existente em `globals.css`.

**Tech Stack:** Next.js, React, CSS global, Vitest Testing Library.

## Global Constraints

- Preservar dados, RLS, normalização de telefone e RPCs existentes.
- Não alterar schema, migrations ou integrações externas.
- Modal deve manter acessibilidade com `role="dialog"` e `aria-modal="true"`.

### Task 1: Modal de criação e edição

**Files:**
- Modify: `tests/ui/manager-connected.test.tsx`
- Modify: `src/components/connected-manager/customers-manager.tsx`

- [ ] **Step 1: Write the failing test**

Renderizar `CustomersManager`, clicar `Novo cliente` e esperar dialog `Novo cliente`; clicar `Editar` e esperar dialog `Editar cliente` com nome preenchido.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx.cmd vitest run tests/ui/manager-connected.test.tsx`
Expected: FAIL porque formulário atual é inline e não possui dialog.

- [ ] **Step 3: Write minimal implementation**

Renderizar o formulário dentro de `div.modal-layer` e `form.form-modal`, com backdrop e botão de fechar; usar `editing` para título e manter handlers atuais.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx.cmd vitest run tests/ui/manager-connected.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run project checks**

Run: `npm.cmd run lint`; `npm.cmd run typecheck`; `npm.cmd run build`.
Expected: PASS sem erros.
