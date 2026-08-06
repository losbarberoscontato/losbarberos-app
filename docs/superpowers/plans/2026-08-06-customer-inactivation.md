# Inativação de clientes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Permitir inativação auditável de clientes, filtro Ativos/Inativos e impedir seleção de clientes inativos na Agenda.

**Architecture:** Adicionar campos incrementais na tabela `customers` para motivo e data da inativação. A tela Clientes controla o modal de motivo e o filtro local; a mutation atualiza `active`, motivo e timestamp no mesmo update. A Agenda filtra `active=true` antes da busca e seleção.

**Tech Stack:** Next.js 16, React, TypeScript, Supabase, Vitest Testing Library.

## Global Constraints

- Preservar dados existentes; migration somente aditiva e compatível.
- Toda escrita permanece tenant-scoped por `organization_id`.
- Não executar migration remota, deploy ou publicação sem autorização explícita.
- Cliente inativo nunca aparece na pesquisa de novo agendamento.

---

### Task 1: Migration e tipos de cliente

**Files:**
- Create: `supabase/migrations/202608060005_customer_inactivation_reason.sql`
- Modify: `src/components/connected-manager/types.ts`
- Modify: `src/components/connected-manager/server.ts`

- [ ] Escrever migration aditiva com `inactivation_reason text` e `inactivated_at timestamptz`, ambos nullable, e atualizar o select de Clientes.
- [ ] Estender `CustomerRecord` com os dois campos.
- [ ] Rodar typecheck para detectar consumidores incompletos.

### Task 2: Fluxo de inativação e filtro na tela Clientes

**Files:**
- Modify: `src/components/connected-manager/customers-manager.tsx`
- Modify: `tests/ui/manager-connected.test.tsx`

- [ ] Escrever testes RED para modal, opções, campo condicional “Outro motivo”, filtro Ativos/Inativos e payload de reativação.
- [ ] Implementar estado do cliente pendente, motivo selecionado e texto livre.
- [ ] Implementar update tenant-scoped: inativar grava `active=false`, motivo e `inactivated_at`; reativar limpa motivo/data e grava `active=true`.
- [ ] Aplicar filtro selecionado sem remover registros do estado carregado.
- [ ] Rodar testes UI e confirmar GREEN.

### Task 3: Busca da Agenda

**Files:**
- Modify: `src/components/connected-manager/agenda-manager.tsx`
- Modify: `tests/ui/manager-connected.test.tsx`

- [ ] Escrever teste RED com cliente ativo e inativo; confirmar que somente o ativo aparece ao pesquisar.
- [ ] Filtrar `availableCustomers` por `customer.active` antes de calcular `matchingCustomers`.
- [ ] Rodar testes UI e confirmar GREEN.

### Task 4: Validação final

- [ ] Rodar `npm.cmd run lint`.
- [ ] Rodar `npm.cmd run typecheck`.
- [ ] Rodar `npm.cmd run build`.
- [ ] Rodar `git diff --check` e revisar status; não executar escrita remota.
