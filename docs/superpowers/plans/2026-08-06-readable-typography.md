# Tipografia legivel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aumentar textos da interface em cerca de 12% com comportamento consistente em desktop e mobile.

**Architecture:** Ajuste localizado em `src/app/globals.css`, mantendo layout e breakpoints existentes. Regressão visual mínima via Playwright na rota `/entrar`.

**Tech Stack:** Next.js, CSS global, Playwright, ESLint, TypeScript.

## Global Constraints

- Preservar dados e integrações existentes.
- Não alterar migrations, APIs, autenticação ou contratos externos.
- Manter alvos touch e responsividade PWA.

### Task 1: Regressão e ajuste tipográfico

**Files:**
- Modify: `tests/e2e/los-barberos.spec.ts`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Write the failing test**

Adicionar teste que navega para `/entrar` e verifica `font-size` computado do texto de apoio do formulário, esperando valor mínimo equivalente ao aumento definido.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd run test:e2e -- tests/e2e/los-barberos.spec.ts`
Expected: FAIL se o valor atual ficar abaixo do novo mínimo.

- [ ] **Step 3: Write minimal implementation**

Aumentar seletivamente os valores tipográficos pequenos em `src/app/globals.css` em aproximadamente 12%, incluindo labels, texto auxiliar, navegação e controles da tela de entrada; não alterar tamanhos de títulos hero nem dimensões de containers.

- [ ] **Step 4: Run focused verification**

Run: `npm.cmd run test:e2e -- tests/e2e/los-barberos.spec.ts`; `npm.cmd run lint`; `npm.cmd run typecheck`.
Expected: PASS sem erros.

- [ ] **Step 5: Run production build**

Run: `npm.cmd run build`
Expected: build Next.js concluído.
