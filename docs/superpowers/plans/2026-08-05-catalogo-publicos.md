# Catálogo com Públicos, Pacotes e Inativação Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classificar serviços/pacotes por múltiplos públicos, filtrar o agendamento, corrigir substituição de itens e inativar pacotes com confirmação.

**Architecture:** Migration incremental adicionará `audiences text[]` validado em `services` e `packages`; RPCs e projeção pública transportarão o campo. Gestor manterá mutações tenant-scoped; cliente/demo filtrarão o catálogo antes da seleção. Itens históricos de pacotes continuam soft-deactivated e leituras usarão somente ativos.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase/PostgreSQL, Vitest, Testing Library, Playwright.

## Global Constraints

- Valores públicos: `INFANTIL`, `FEMININO`, `MASCULINO`, `OUTROS_SERVICOS`.
- Registros existentes começam com `audiences = '{}'` e ficam ocultos no catálogo público.
- Novos serviços/pacotes exigem pelo menos um público.
- Dinheiro permanece em centavos; nenhuma linha existente será apagada.
- Toda escrita mantém `organization_id`, RPC/RLS e idempotência transacional.
- Não aplicar migration remota/deploy até validação e autorização de publicação.

---

### Task 1: Modelos e helpers de público

**Files:**
- Create: `src/lib/catalog-audiences.ts`
- Modify: `src/components/connected-manager/types.ts`
- Modify: `src/components/connected-client/types.ts`
- Modify: `src/components/connected-client/format.ts`
- Test: `tests/ui/catalog-audiences.test.ts`

**Interfaces:**
- Produz `CATALOG_AUDIENCES`, `CatalogAudience`, `audienceLabel`, `hasAudience`, `filterByAudience`.
- `ServiceRecord`, `PackageRecord`, `PublicService`, `PublicPackage`, `CatalogChoice` passam a carregar `audiences: CatalogAudience[]`.

- [ ] Escrever testes falhando para labels, exigência de um público e filtragem por público.
- [ ] Rodar `npm.cmd run test -- tests/ui/catalog-audiences.test.ts`; confirmar falha por helper/tipos ausentes.
- [ ] Implementar constantes e helpers sem duplicar regras entre gestor/cliente/demo.
- [ ] Rodar teste específico; confirmar verde.

### Task 2: Migration e RPCs do catálogo

**Files:**
- Create: `supabase/migrations/202608050001_catalog_audiences.sql`
- Test: `supabase/tests/002_catalog_audiences.sql`

**Interfaces:**
- Migration adiciona `services.audiences` e `packages.audiences` com default vazio e constraint dos quatro valores.
- Atualiza `save_package_with_items` para receber `p_audiences text[]`, validar não vazio e persistir.
- Atualiza `get_public_booking_context` para retornar públicos e filtrar somente itens ativos com pelo menos um público.

- [ ] Escrever testes SQL falhando para default vazio, valores inválidos, públicos obrigatórios em novos registros e projeção pública.
- [ ] Rodar o teste database correspondente e confirmar falha por schema ausente.
- [ ] Criar migration incremental com `alter table`, `create or replace function`, grants preservados e checks tenant-scoped.
- [ ] Rodar testes PostgreSQL locais e confirmar verde.

### Task 3: Gestor — formulário e edição idempotente

**Files:**
- Modify: `src/components/connected-manager/catalog-manager.tsx`
- Modify: `src/components/connected-manager/server.ts`
- Modify: `src/components/connected-manager/types.ts`
- Test: `tests/ui/catalog-manager.test.tsx`

**Interfaces:**
- Formulários exibem quatro checkboxes e bloqueiam salvar quando nenhum está marcado.
- `saveService` envia `audiences`.
- `savePackage` envia `p_audiences`.
- Leitura de `package_items` filtra `active = true`; edição e contagem usam somente links ativos.

- [ ] Escrever testes falhando para checkboxes múltiplos, payload de públicos, itens ativos e conjunto editado sem soma histórica.
- [ ] Rodar teste específico e confirmar falha.
- [ ] Implementar estado controlado e filtros ativos, mantendo itens históricos no banco.
- [ ] Rodar teste específico e confirmar verde.

### Task 4: Gestor — modal de inativação

**Files:**
- Modify: `src/components/connected-manager/catalog-manager.tsx`
- Modify: `src/components/connected-manager/connected-manager.module.css` if modal styles are absent
- Test: `tests/ui/catalog-manager.test.tsx`

- [ ] Escrever testes falhando para abrir modal, cancelar sem mutation e confirmar `active = false` tenant-scoped.
- [ ] Rodar teste e confirmar falha.
- [ ] Implementar modal visual reutilizável local ao catálogo; manter reativação existente.
- [ ] Rodar teste e confirmar verde.

### Task 5: Cliente conectado e demo — filtro de público

**Files:**
- Modify: `src/components/connected-client/format.ts`
- Modify: `src/components/connected-client/booking.tsx`
- Modify: `src/components/connected-client/types.ts`
- Modify: `src/data/demo.ts`
- Modify: `src/components/booking-flow.tsx`
- Test: `tests/ui/client-connected.test.tsx`
- Test: `tests/e2e/los-barberos.spec.ts` if stable selector coverage is needed

- [ ] Escrever testes falhando para filtro antes do catálogo, troca de público e ocultação de itens sem público/inativos.
- [ ] Rodar testes e confirmar falha.
- [ ] Implementar filtro compartilhado; contexto público já deve omitir inativos e sem público no SQL.
- [ ] Classificar dados demo e adicionar filtro equivalente sem alterar fluxo de pagamento demo.
- [ ] Rodar testes UI/E2E aplicáveis e confirmar verde.

### Task 6: Verificação e publicação preparada

**Files:**
- No production code beyond fixes above.
- Verify: `git diff`, migration list, tests and build output.

- [ ] Rodar `npm.cmd run lint`.
- [ ] Rodar `npm.cmd run typecheck`.
- [ ] Rodar `npm.cmd run test`.
- [ ] Rodar `npm.cmd run build` e corrigir somente regressões do escopo.
- [ ] Iniciar `npm.cmd run start -- --hostname 127.0.0.1 --port 3000` e validar gestor/catalogo/agendamento.
- [ ] Confirmar worktree, migration remota ainda não aplicada e listar evidências pendentes para publicação.
