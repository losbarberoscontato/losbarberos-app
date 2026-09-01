-- A manual receipt may be posted to an account different from the payment-mode default.
-- Keep the default mapping only as a fallback for legacy/unclassified transactions.
create or replace view public.appointment_cash_activity
with (security_invoker = true) as
select t.id as payment_transaction_id, t.organization_id, t.appointment_id,
  a.customer_id, a.payment_mode, t.provider, t.kind, t.amount_cents, t.currency,
  t.occurred_at, coalesce(rc.financial_account_id, m.financial_account_id) as financial_account_id,
  (coalesce(rc.financial_account_id, m.financial_account_id) is null) as needs_reconciliation,
  case when t.kind in ('CAPTURE', 'ADJUSTMENT') then t.amount_cents else -t.amount_cents end::bigint as signed_cents
from public.payment_transactions t
join public.appointments a on a.id = t.appointment_id and a.organization_id = t.organization_id
left join public.appointment_receipt_classifications rc
  on rc.organization_id = t.organization_id and rc.payment_transaction_id = t.id
left join public.payment_account_mappings m on m.organization_id = t.organization_id
  and m.provider = t.provider and m.payment_mode = a.payment_mode;
