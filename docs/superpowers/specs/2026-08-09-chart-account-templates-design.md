# Chart Account Templates Design

## Goal

Provide the 42-account management chart from `Plano_de_Contas_Simplificado_Barbearia.pdf` to every newly created organization and replace the unused chart of `Barbearia Central`.

## Data model

`default_chart_account_templates` is global, has no `organization_id`, and stores `code`, `name`, `kind`, and `parent_code`. `parent_code` is resolved only after each tenant copy is inserted, preserving the existing composite tenant foreign key on `chart_of_accounts`.

## Provisioning and replacement

An `AFTER INSERT` trigger on `organizations` calls an idempotent security-definer seed function. It inserts no rows when a tenant already has chart accounts. A maintenance-only replacement function deletes a tenant chart only after confirming that no `financial_entries` reference it, then invokes the same seed function. It is not granted to browser roles.

## Scope and safety

The template contains 12 revenue and 30 expense accounts, all from the supplied PDF. Existing tenants are not backfilled automatically. The explicitly authorized `Barbearia Central` import uses the maintenance function after remote verification that its three current accounts have no financial-entry references. No ledger, appointment, supplier, bank, or cost-center data changes.

## Verification

Migration contract tests assert template, trigger, seed and replacement interfaces. Database invariants assert a new organization receives 42 tenant-scoped accounts with a resolved parent. Remote checks confirm 42 accounts in `Barbearia Central`, 12 `REVENUE`, 30 `EXPENSE`, correct parent links, and no remaining legacy accounts.
