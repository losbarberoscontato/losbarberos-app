# Package Filter Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mover o filtro Ativos/Inativos para dentro do cabeçalho do card Pacotes.

**Architecture:** O componente compartilhado `Panel` aceitará um título ReactNode. O `CatalogManager` passará um grupo com título e select, eliminando o filtro absoluto externo.

**Tech Stack:** React, TypeScript, CSS Modules, Vitest, Testing Library.

## Global Constraints

- O filtro afeta somente pacotes.
- Ativos é o estado inicial.
- Sem posicionamento absoluto.

---

### Task 1: Cabeçalho do card Pacotes

**Files:**
- Modify: `src/components/connected-manager/catalog-manager.tsx`
- Modify: `src/components/connected-manager/connected-manager.module.css`
- Test: `tests/ui/catalog-manager.test.tsx`

**Interfaces:**
- Consumes: estado `packageFilter`.
- Produces: select `aria-label="Filtro de pacotes"` dentro do título do Panel.

- [ ] **Step 1: Atualizar teste para validar valor inicial e troca de opção**
- [ ] **Step 2: Remover filtro externo e inserir select no título do Panel**
- [ ] **Step 3: Remover CSS absoluto e adicionar layout flexível do título**
- [ ] **Step 4: Rodar `npm.cmd run typecheck` e teste focado**
- [ ] **Step 5: Commitar a correção**
