# Cash Reconciliation and Default Account Design

## Goal

Make Cash show appointment payment state without confusing it with bank-account reconciliation, add date filtering and appointment descriptions, and provision a tenant-safe physical-cash account by default.

## Cash presentation

The Movements panel has explicit columns: Description, Date, Amount, Financial account, Payment status, and Actions. Appointment activity uses the authoritative `appointment_financial_summary` status. A captured and fully paid appointment is shown as `Recebido`, even when no account mapping exists. Missing mapping is shown only in the Financial account column as `Não vinculada`; neither `Aguardando conciliação` nor a duplicate `PENDENTE` payment chip is rendered.

Appointment descriptions are server-derived from the immutable appointment item snapshots plus barber display name: `<service/package names> · Profissional: <barber>`. Manual entries retain their own description. Date range is inclusive and filters manual entries by `due_date` and appointment activity by the payment transaction occurrence date. Cash summary cards remain global because account balance is not a date-range balance.

## Default financial account

`financial_accounts` gains nullable `description`. A global template provisions one tenant row named `Caixa Físico`: kind `CASH`, opening balance `0`, bank code `0`, branch `1`, account number `0`, and description `Caixa físico para recebimento à vista em dinheiro físico.`.

An idempotent security-definer seed inserts this account when the tenant has no account with that name, preserves inactive/existing user rows, and creates `MANUAL`/`COUNTER` mapping only when absent. New organizations receive it through an `AFTER INSERT` trigger. The migration backfills existing organizations additively, so previously captured manual counter payments resolve to the default cash account without changing payment transactions or appointment status.

## Safety and verification

All financial account rows remain tenant-scoped. The seed and trigger are not browser-executable. No payment transaction, appointment, ledger event, or existing mapping is edited. Tests cover presentation semantics, range filtering, description composition, default-account migration contract, tenant isolation, idempotency, default mapping, and description save/load.
