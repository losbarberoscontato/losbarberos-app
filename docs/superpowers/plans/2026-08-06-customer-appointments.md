# Histórico de agendamentos do cliente Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar última visita concluída e histórico completo de agendamentos em modal.

**Architecture:** O server loader entrega dados tenant-safe já usados nos módulos conectados. `CustomersManager` deriva agrupamentos por cliente e renderiza modal padrão existente, sem alterar mutações.

**Tech Stack:** Next.js, Supabase server client, React, Vitest Testing Library, CSS global.

## Global Constraints

- Toda leitura deve filtrar `organization_id`.
- Preservar dados, RLS, migrations e contratos de escrita.
- Dinheiro permanece em centavos; apresentação usa `formatCents`.

### Task 1: Histórico e última visita

**Files:**
- Modify: `src/components/connected-manager/server.ts`
- Modify: `src/components/connected-manager/types.ts`
- Modify: `src/components/connected-manager/customers-manager.tsx`
- Modify: `tests/ui/manager-connected.test.tsx`

- [ ] **Step 1: Write the failing test**

Renderizar `CustomersManager` com agendamento concluído, item snapshot, financeiro, barbeiro e evento de reagendamento; verificar texto de última visita, botão `Ver Agendamentos`, dialog e campos do histórico.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx.cmd vitest run tests/ui/manager-connected.test.tsx`
Expected: FAIL porque Clientes não recebe nem exibe histórico.

- [ ] **Step 3: Write minimal implementation**

Adicionar leituras no loader e derivar status, serviço, valor pago e dias desde última conclusão; abrir modal com dados básicos e tabela.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx.cmd vitest run tests/ui/manager-connected.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run project checks**

Run: `npm.cmd run lint`; `npm.cmd run typecheck`; `npm.cmd run build`.
Expected: PASS sem erros.
