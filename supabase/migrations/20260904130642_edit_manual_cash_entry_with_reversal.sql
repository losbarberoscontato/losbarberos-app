create or replace function public.edit_manual_cash_entry_with_reversal(
  p_settlement_id uuid, p_description text, p_issue_date date, p_due_date date, p_total_cents bigint,
  p_chart_account_id uuid, p_cost_center_id uuid default null, p_financial_account_id uuid default null,
  p_counterparty_kind public.financial_counterparty_kind default null, p_customer_id uuid default null, p_supplier_id uuid default null,
  p_document_number text default null, p_tag_ids uuid[] default '{}'::uuid[], p_payment_method public.financial_payment_method default 'OTHER',
  p_reference text default null, p_idempotency_key text default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_source public.financial_settlements%rowtype; v_entry public.financial_entries%rowtype; v_new uuid;
begin
  if nullif(btrim(p_idempotency_key), '') is null then raise exception using errcode='22023', message='idempotency key is required'; end if;
  select s.* into strict v_source from public.financial_settlements s where s.id=p_settlement_id for update;
  select e.* into strict v_entry from public.financial_entries e where e.id=v_source.entry_id for update;
  perform public.require_financial_owner(v_entry.organization_id, 'manual cash entry edit');
  if v_entry.source <> 'MANUAL' or v_source.kind <> 'SETTLEMENT' then raise exception using errcode='22023', message='only manual cash entries can be edited'; end if;
  if exists(select 1 from public.financial_settlements where organization_id=v_entry.organization_id and idempotency_key=p_idempotency_key) then return v_entry.id; end if;
  perform public.reverse_financial_settlement(p_settlement_id, v_source.amount_cents, 'Lançamento manual editado', p_idempotency_key||':reversal');
  v_new := public.create_and_settle_financial_entry(v_entry.organization_id, v_entry.kind, p_description, p_issue_date, p_due_date, p_total_cents, p_chart_account_id, p_cost_center_id, p_financial_account_id, p_counterparty_kind, p_customer_id, p_supplier_id, p_document_number, p_tag_ids, p_financial_account_id, p_payment_method, p_reference, p_idempotency_key);
  return v_new;
end; $$;

revoke all on function public.edit_manual_cash_entry_with_reversal(uuid,text,date,date,bigint,uuid,uuid,uuid,public.financial_counterparty_kind,uuid,uuid,text,uuid[],public.financial_payment_method,text,text) from public,anon,authenticated,service_role;
grant execute on function public.edit_manual_cash_entry_with_reversal(uuid,text,date,date,bigint,uuid,uuid,uuid,public.financial_counterparty_kind,uuid,uuid,text,uuid[],public.financial_payment_method,text,text) to authenticated;
