# Public Legal Pages and Meta Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicar três páginas legais estáticas, preparar domínio canônico migrável e entregar o ícone Meta 1024 × 1024 sem tocar no banco.

**Architecture:** Server Components estáticos usam um componente legal compartilhado e configuração pública centralizada. Conteúdo fica em cada rota; origem canônica vem de `NEXT_PUBLIC_SITE_URL` com fallback para Vercel. O PNG é renderizado do SVG oficial com `sharp` já presente na árvore de dependências.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, CSS Modules, Vitest, Testing Library, Sharp, Vercel.

## Global Constraints

- Responsável público: `JULIO CESAR HEIDEN JUNIOR 05128841960`.
- Canal LGPD: `contato@losbarberos.com.br`.
- Origem atual: `https://losbarberos-app.vercel.app`.
- Origem futura: `https://losbarberos.com.br`.
- Rotas estáveis: `/privacidade`, `/termos`, `/exclusao-de-dados`.
- Não criar migration nem acessar Supabase, auth ou tenant.
- Não expor segredos.
- Conteúdo em PT-BR, versão 1.0, vigência em 12/08/2026.
- Revisão jurídica pendente aparece somente no handoff interno.

---

### Task 1: Configuração pública e contrato das páginas

**Files:**
- Create: `src/lib/public-site.ts`
- Create: `tests/unit/public-site.test.ts`
- Create: `tests/ui/legal-pages.test.tsx`

**Interfaces:**
- Produces: `DEFAULT_PUBLIC_SITE_ORIGIN`, `resolvePublicSiteOrigin(value?: string): string`, `publicSite`.
- Produces: contrato de conteúdo e navegação que as rotas da Task 2 devem satisfazer.

- [ ] **Step 1: Escrever testes falhando da configuração**

```ts
expect(resolvePublicSiteOrigin()).toBe("https://losbarberos-app.vercel.app");
expect(resolvePublicSiteOrigin("https://losbarberos.com.br/agenda"))
  .toBe("https://losbarberos.com.br");
expect(resolvePublicSiteOrigin("javascript:alert(1)"))
  .toBe("https://losbarberos-app.vercel.app");
```

- [ ] **Step 2: Escrever testes falhando das páginas**

Importar as três páginas ainda inexistentes e afirmar títulos, responsável, e-mail LGPD, papéis controlador/operador, direitos e dois caminhos de exclusão. Importar `HomePage` e afirmar links relativos para as três rotas.

- [ ] **Step 3: Executar RED**

Run: `npm.cmd test -- tests/unit/public-site.test.ts tests/ui/legal-pages.test.tsx`

Expected: FAIL porque módulos e rotas ainda não existem.

- [ ] **Step 4: Implementar configuração mínima**

Validar com `URL`, aceitar somente `https:` e `http:` para localhost, retornar apenas `origin`, congelar nome, responsável, contato, versão e data pública.

- [ ] **Step 5: Executar teste focado da configuração**

Run: `npm.cmd test -- tests/unit/public-site.test.ts`

Expected: PASS.

### Task 2: Layout e conteúdo legal

**Files:**
- Create: `src/components/legal/legal-page.tsx`
- Create: `src/components/legal/legal-page.module.css`
- Create: `src/app/privacidade/page.tsx`
- Create: `src/app/termos/page.tsx`
- Create: `src/app/exclusao-de-dados/page.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/page.tsx`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `publicSite` e `resolvePublicSiteOrigin` da Task 1.
- Produces: páginas estáticas, metadata por rota e navegação legal acessível.

- [ ] **Step 1: Implementar componente compartilhado**

Criar cabeçalho com `Brand`, navegação entre documentos, `<main>` semântico, índice opcional, contato `mailto:` e rodapé. Usar CSS Module mobile-first com largura de leitura, foco visível, contraste, tipografia e impressão legível.

- [ ] **Step 2: Implementar Política de Privacidade**

Cobrir identificação, papéis controlador/operador, dados, finalidades/bases, compartilhamento, transferências, cookies essenciais, segurança, retenção, menores, direitos e atualização.

- [ ] **Step 3: Implementar Termos de Uso**

Cobrir aceitação, escopo, contas, responsabilidades, agenda, integrações/pagamentos, conteúdo, propriedade intelectual, uso proibido, disponibilidade, suspensão, responsabilidade, lei e contato.

- [ ] **Step 4: Implementar Exclusão de Dados**

Exibir fluxo autenticado e fluxo por e-mail, dados mínimos do pedido, verificação de identidade, etapas, exceções de retenção e confirmação segura.

- [ ] **Step 5: Atualizar metadata e rodapé**

Definir `metadataBase` com origem central, canonical por página, links relativos reais no rodapé e `NEXT_PUBLIC_SITE_URL` documentada em `.env.example`.

- [ ] **Step 6: Executar GREEN das páginas**

Run: `npm.cmd test -- tests/unit/public-site.test.ts tests/ui/legal-pages.test.tsx`

Expected: PASS.

### Task 3: Ícone Meta 1024 × 1024

**Files:**
- Create: `public/icon-1024.png`
- Modify: `public/manifest.webmanifest`

**Interfaces:**
- Consumes: `public/icon.svg` sem alterar sua geometria ou cores.
- Produces: PNG RGB/RGBA 1024 × 1024, acessível em `/icon-1024.png`.

- [ ] **Step 1: Renderizar com Sharp**

Run: `node -e "const fs=require('node:fs');const sharp=require('sharp');sharp(fs.readFileSync('public/icon.svg')).resize(1024,1024).png().toFile('public/icon-1024.png')"`

- [ ] **Step 2: Validar dimensões**

Run: `node -e "require('sharp')('public/icon-1024.png').metadata().then(m=>{if(m.width!==1024||m.height!==1024)process.exit(1);console.log(m.width+'x'+m.height)})"`

Expected: `1024x1024`.

- [ ] **Step 3: Adicionar ícone ao manifest e inspecionar visualmente**

Adicionar entrada `sizes: "1024x1024"`, `type: "image/png"`, `purpose: "any"`; abrir o PNG e confirmar marca, cores, cantos e ausência de artefatos.

### Task 4: Verificação local e documentação de release

**Files:**
- Modify: `HANDOFF.md`
- Modify: `IMPLEMENTATION_PROMPT.md`

**Interfaces:**
- Consumes: páginas e ícone concluídos.
- Produces: estado verificável e instruções para Meta/domínio futuro.

- [ ] **Step 1: Executar verificação focada e completa**

Run: `npm.cmd test -- tests/unit/public-site.test.ts tests/ui/legal-pages.test.tsx`

Run: `npm.cmd run verify`

Expected: zero falhas; build classifica três rotas como estáticas.

- [ ] **Step 2: Executar servidor de produção local**

Run: `npm.cmd run start -- -p 3200`

Smoke: `/privacidade`, `/termos`, `/exclusao-de-dados`, `/entrar` retornam HTTP 200.

- [ ] **Step 3: Inspecionar desktop e mobile**

Capturar as três páginas em 1440 × 900 e 390 × 844; confirmar leitura, navegação, links e ausência de overflow.

- [ ] **Step 4: Atualizar handoff**

Registrar URLs, versão jurídica 1.0, revisão jurídica pendente, variável de domínio e nenhuma migration.

### Task 5: GitHub, CI e Vercel

**Files:**
- Commit all files from Tasks 1–4.

**Interfaces:**
- Produces: `origin/main` atualizado e deployment Vercel verificável.

- [ ] **Step 1: Revisar diff e segurança**

Run: `git diff --check`

Run: `git status --short`

Run: `rg -n "secret|token|Authorization|Bearer" src/app/privacidade src/app/termos src/app/exclusao-de-dados src/components/legal src/lib/public-site.ts`

- [ ] **Step 2: Commitar implementação**

Run: `git add ... && git commit -m "feat: publish legal pages for Meta review"`

- [ ] **Step 3: Revalidar origin e publicar main**

Run: `git fetch origin && git rev-parse origin/main`

Somente se ainda for ancestral do branch: `git push origin HEAD:main`.

- [ ] **Step 4: Observar CI e Vercel**

Esperar checks GitHub em estado final. Confirmar deployment ligado ao commit publicado; não inferir deploy apenas por HTTP 200.

- [ ] **Step 5: Smoke de produção**

Confirmar HTTP 200 e conteúdo esperado nas três páginas, `/entrar` HTTP 200 e `/gestor` redirect protegido. Confirmar `icon-1024.png` HTTP 200 e dimensões locais.

- [ ] **Step 6: Entregar próximo passo Meta**

Fornecer URLs exatas para Política de Privacidade, Termos e Exclusão, categoria recomendada e link local clicável para download do ícone.
