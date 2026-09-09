-- Manual entries created from Caixa are already paid/received.
-- Creation and settlement stay atomic and tenant-scoped.
create or replace function public.create_and_settle_financial_entry(
  p_organization_id uuid, p_kind public.financial_entry_kind, p_description text, p_issue_date date, p_due_date date, p_total_cents bigint,
  p_chart_account_id uuid, p_cost_center_id uuid default null, p_preferred_financial_account_id uuid default null,
  p_counterparty_kind public.financial_counterparty_kind default null, p_customer_id uuid default null, p_supplier_id uuid default null,
  p_document_number text default null, p_tag_ids uuid[] default '{}'::uuid[],
  p_financial_account_id uuid default null, p_payment_method public.financial_payment_method default 'OTHER',
  p_reference text default null, p_idempotency_key text default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_entry_id uuid; v_existing public.financial_settlements%rowtype;
begin
  if nullif(btrim(p_idempotency_key), '') is null then raise exception using errcode = '22023', message = 'idempotency key is required'; end if;
  perform public.require_financial_owner(p_organization_id, 'financial cash entry mutation');
  select s.* into v_existing from public.financial_settlements s where s.organization_id = p_organization_id and s.idempotency_key = p_idempotency_key;
  if found then return v_existing.entry_id; end if;
  if p_financial_account_id is null then raise exception using errcode = '22023', message = 'active financial account is required'; end if;
  v_entry_id := public.create_financial_entry(p_organization_id, p_kind, p_description, p_issue_date, p_due_date, p_total_cents, p_chart_account_id, p_cost_center_id, p_financial_account_id, p_counterparty_kind, p_customer_id, p_supplier_id, p_document_number, p_tag_ids);
  perform public.settle_financial_entry(v_entry_id, p_financial_account_id, p_total_cents, p_due_date, p_payment_method, p_reference, p_idempotency_key);
  return v_entry_id;
end;
$$;

revoke all on function public.create_and_settle_financial_entry(uuid, public.financial_entry_kind, text, date, date, bigint, uuid, uuid, uuid, public.financial_counterparty_kind, uuid, uuid, text, uuid[], uuid, public.financial_payment_method, text, text) from public, anon, authenticated, service_role;
grant execute on function public.create_and_settle_financial_entry(uuid, public.financial_entry_kind, text, date, date, bigint, uuid, uuid, uuid, public.financial_counterparty_kind, uuid, uuid, text, uuid[], uuid, public.financial_payment_method, text, text) to authenticated;
