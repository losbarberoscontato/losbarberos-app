-- Baixa de parcela de projeto com os mesmos metadados do recebimento de atendimento.
-- Mantém a liquidação e a classificação financeira na mesma transação.
create or replace function public.settle_project_installment_receipt(
  p_entry_id uuid,
  p_financial_account_id uuid,
  p_amount_cents bigint,
  p_settled_on date,
  p_payment_method public.financial_payment_method,
  p_reference text,
  p_idempotency_key text,
  p_chart_account_id uuid,
  p_cost_center_id uuid default null,
  p_document_number text default null,
  p_tag_ids uuid[] default '{}'::uuid[]
) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_entry public.financial_entries%rowtype;
  v_settlement uuid;
begin
  select * into strict v_entry
    from public.financial_entries
   where id = p_entry_id
     and source = 'PROJECT'
   for update;
  perform public.require_financial_owner(v_entry.organization_id, 'project installment receipt');

  if not exists (
    select 1 from public.chart_of_accounts
     where id = p_chart_account_id
       and organization_id = v_entry.organization_id
       and kind = 'REVENUE'
       and active
  ) then
    raise exception using errcode = '22023', message = 'active revenue chart account is required';
  end if;
  if p_cost_center_id is not null and not exists (
    select 1 from public.cost_centers
     where id = p_cost_center_id
       and organization_id = v_entry.organization_id
       and active
  ) then
    raise exception using errcode = '22023', message = 'active cost center must be tenant scoped';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_tag_ids, '{}'::uuid[])) tag_id
     where not exists (
       select 1 from public.financial_tags
        where id = tag_id
          and organization_id = v_entry.organization_id
          and active
     )
  ) then
    raise exception using errcode = '22023', message = 'all tags must be active and tenant scoped';
  end if;

  v_settlement := public.settle_financial_entry(
    p_entry_id,
    p_financial_account_id,
    p_amount_cents,
    p_settled_on,
    p_payment_method,
    p_reference,
    p_idempotency_key
  );

  update public.financial_entries
     set chart_account_id = p_chart_account_id,
         cost_center_id = p_cost_center_id,
         document_number = nullif(btrim(p_document_number), '')
   where id = v_entry.id;

  delete from public.financial_entry_tags where entry_id = v_entry.id;
  insert into public.financial_entry_tags (organization_id, entry_id, tag_id)
  select v_entry.organization_id, v_entry.id, tag_id
    from unnest(coalesce(p_tag_ids, '{}'::uuid[])) tag_id;

  return v_settlement;
exception when no_data_found then
  raise exception using errcode = 'P0002', message = 'project financial entry not found';
end;
$$;

revoke all on function public.settle_project_installment_receipt(uuid, uuid, bigint, date, public.financial_payment_method, text, text, uuid, uuid, text, uuid[]) from public, anon;
grant execute on function public.settle_project_installment_receipt(uuid, uuid, bigint, date, public.financial_payment_method, text, text, uuid, uuid, text, uuid[]) to authenticated;
