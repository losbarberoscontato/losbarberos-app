# Coming Soon Cloudflare Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Criar uma página HTML5 estática para `losbarberos.com.br`, com identidade visual Los Barberos e contato direto por WhatsApp.

**Architecture:** Um único `index.html` em `cloudflare-pages/`, contendo marcação, CSS responsivo e SVG inline do ícone WhatsApp. A pasta pode ser publicada diretamente como site estático no Cloudflare Pages, sem build ou backend.

**Tech Stack:** HTML5 sem dependências; CSS3; SVG inline; Cloudflare Pages.

## Global Constraints

- Produto e comunicação em PT-BR.
- Usar paleta existente do sistema: verde floresta, papel claro, âmbar e verde de ação.
- WhatsApp deve apontar para `+5547999782545` via `https://wa.me/`.
- Não incluir segredos, analytics, dependências externas ou dados privados.
- Não aplicar deploy nem alterar DNS nesta tarefa.

### Task 1: Static landing page

**Files:**
- Create: `cloudflare-pages/index.html`

**Interfaces:**
- Produces: documento estático servido como `/index.html` pelo Cloudflare Pages.
- External link: botão WhatsApp abre `https://wa.me/5547999782545` com mensagem URL-encoded.

- [ ] Criar documento HTML5 com `lang="pt-BR"`, metadata viewport, título e description.
- [ ] Reproduzir mark `LB`, wordmark Los Barberos e subtítulo do sistema.
- [ ] Aplicar layout central responsivo com título, mensagem e CTA acessível.
- [ ] Adicionar foco visível, `rel="noopener"` e SVG do WhatsApp sem fonte externa.

### Task 2: Verification

**Files:**
- Verify: `cloudflare-pages/index.html`

- [ ] Confirmar estrutura HTML com `rg` e ausência de placeholders/segredos.
- [ ] Rodar `git diff --check`.
- [ ] Executar smoke test HTTP local caso servidor estático esteja disponível.
