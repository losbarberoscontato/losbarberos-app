# Los Barberos — regras do projeto

- Código, migrations, testes e documentação deste repositório são fonte de verdade.
- Comunicação e produto em PT-BR; nomes técnicos permanecem em inglês quando são contratos externos.
- Dinheiro sempre em centavos inteiros. Percentuais em basis points.
- Todo dado comercial precisa `organization_id`; nenhuma relação cross-tenant é aceita.
- Escritas críticas de agenda, pagamento, billing e comissão devem ser atômicas e idempotentes.
- Ledgers e eventos são append-only; correções usam reversal/adjustment.
- Segredos nunca entram no browser, logs, commits ou tabelas públicas.
- Service worker não cacheia auth, APIs, navegações autenticadas ou dados privados.
- Migrations são incrementais e compatíveis. Não aplicar migration remota, deploy ou escrita externa sem autorização explícita.
- Não declarar produção validada sem prova real de Supabase, Stripe, Mercado Pago, Meta e Vercel.
- No Windows, usar `npm.cmd` e `npx.cmd`.


<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
