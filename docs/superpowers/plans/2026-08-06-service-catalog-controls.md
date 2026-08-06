# Service Catalog Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar filtro e ativação segura ao card Serviços e validar o botão Editar.

**Architecture:** `CatalogManager` manterá filtro e confirmação próprios para serviços. A RPC security-definer `set_service_active` fará somente a mudança de status com validação de owner e organização.

**Tech Stack:** React, TypeScript, Supabase/PostgreSQL, Vitest, Testing Library.

## Global Constraints

- Dados existentes devem ser preservados.
- A migration é incremental.
- O filtro inicia em Ativos e afeta somente Serviços.
- Nenhuma migration remota sem autorização específica.

---

### Task 1: Testes de regressão

**Files:**
- Modify: `tests/ui/catalog-manager.test.tsx`
- Create: `tests/integrations/service-activation-migration.test.ts`

**Interfaces:**
- Consumes: `CatalogManager` e mocks de `rpc`.
- Produces: expectativas para filtro, edição e `set_service_active`.

- [ ] **Step 1:** Escrever testes que falham para filtro, edição e confirmação.
- [ ] **Step 2:** Rodar os testes e confirmar falha.

### Task 2: UI e RPC

**Files:**
- Modify: `src/components/connected-manager/catalog-manager.tsx`
- Create: `supabase/migrations/202608060003_service_activation_rpc.sql`

**Interfaces:**
- Produces: RPC `set_service_active(uuid, uuid, boolean)`.

- [ ] **Step 1:** Implementar filtro Ativos/Inativos no cabeçalho Serviços.
- [ ] **Step 2:** Implementar modais e chamadas RPC para inativar/reativar.
- [ ] **Step 3:** Criar migration incremental tenant-scoped.
- [ ] **Step 4:** Rodar testes focados, typecheck, lint e suíte completa.
- [ ] **Step 5:** Commitar sem publicar.
