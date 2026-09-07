-- Allow managers to settle only the commission service lines selected in the
-- detail modal. The amount remains authoritative in Postgres.
drop function if exists public.pay_commission(uuid, uuid, date, date, uuid, date, public.financial_payment_method, text, text);

create or replace function public.pay_commission(
  p_organization_id uuid,
  p_barber_id uuid,
  p_period_start date,
  p_period_end date,
  p_appointment_item_ids uuid[],
  p_financial_account_id uuid,
  p_paid_on date,
  p_payment_method public.financial_payment_method,
  p_reference text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payout public.commission_payouts%rowtype;
  v_settlement_id uuid;
  v_ledger public.commission_ledger%rowtype;
  v_selected_item_ids uuid[];
  v_selected_count integer;
  v_amount bigint := 0;
begin
  perform public.require_financial_owner(p_organization_id, 'commission payout');
  if p_period_start > p_period_end or nullif(btrim(p_idempotency_key), '') is null then
    raise exception using errcode = '22023', message = 'valid period and idempotency key are required';
  end if;
  select array_agg(distinct selected_id order by selected_id)
  into v_selected_item_ids
  from unnest(coalesce(p_appointment_item_ids, '{}'::uuid[])) selected_id
  where selected_id is not null;
  if coalesce(cardinality(v_selected_item_ids), 0) = 0 then
    raise exception using errcode = '22023', message = 'at least one commission must be selected';
  end if;
  perform 1 from public.barbers
  where organization_id = p_organization_id and id = p_barber_id and active
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'active barber not found';
  end if;
  if not exists (select 1 from public.financial_accounts where organization_id = p_organization_id and id = p_financial_account_id and active) then
    raise exception using errcode = '22023', message = 'active financial account is required';
  end if;

  select settlement.id into v_settlement_id
  from public.commission_payout_settlements settlement
  where settlement.organization_id = p_organization_id
    and settlement.idempotency_key = p_idempotency_key;
  if v_settlement_id is not null then
    return v_settlement_id;
  end if;

  select count(*)::integer into v_selected_count
  from public.commission_service_details detail
  where detail.organization_id = p_organization_id
    and detail.barber_id = p_barber_id
    and detail.service_date between p_period_start and p_period_end
    and detail.appointment_item_id = any(v_selected_item_ids)
    and detail.payable_commission_cents > 0;
  if v_selected_count <> cardinality(v_selected_item_ids) then
    raise exception using errcode = '22023', message = 'selected commission is not open in the requested period';
  end if;
  if exists (
    select 1
    from public.commission_payout_items payout_item
    join public.commission_payouts payout on payout.organization_id = payout_item.organization_id
      and payout.id = payout_item.payout_id
      and payout.status = 'OPEN'
    join public.commission_ledger ledger on ledger.organization_id = payout_item.organization_id
      and ledger.id = payout_item.ledger_entry_id
    where payout_item.organization_id = p_organization_id
      and payout.barber_id = p_barber_id
      and ledger.appointment_item_id = any(v_selected_item_ids)
  ) then
    raise exception using errcode = '22023', message = 'selected commission is already reserved for payment';
  end if;

  insert into public.commission_payouts (organization_id, barber_id, period_start, period_end, amount_cents)
  values (p_organization_id, p_barber_id, p_period_start, p_period_end, 0)
  returning * into v_payout;

  for v_ledger in
    select ledger.*
    from public.commission_ledger ledger
    join public.commission_service_details detail on detail.organization_id = ledger.organization_id
      and detail.appointment_id = ledger.appointment_id
      and detail.appointment_item_id = ledger.appointment_item_id
    where ledger.organization_id = p_organization_id
      and ledger.barber_id = p_barber_id
      and ledger.appointment_item_id = any(v_selected_item_ids)
      and detail.service_date between p_period_start and p_period_end
      and not exists (
        select 1 from public.commission_payout_items existing
        where existing.organization_id = ledger.organization_id
          and existing.ledger_entry_id = ledger.id
      )
    order by ledger.appointment_item_id, ledger.created_at, ledger.id
    for update of ledger
  loop
    insert into public.commission_payout_items (organization_id, payout_id, ledger_entry_id)
    values (p_organization_id, v_payout.id, v_ledger.id);
    v_amount := v_amount + v_ledger.amount_cents;
  end loop;
  if v_amount <= 0 then
    raise exception using errcode = '22023', message = 'no positive unpaid commission in selection';
  end if;
  update public.commission_payouts
  set amount_cents = v_amount
  where organization_id = p_organization_id and id = v_payout.id;

  insert into public.commission_payout_settlements (
    organization_id, payout_id, financial_account_id, amount_cents, paid_on,
    payment_method, reference, idempotency_key, created_by
  ) values (
    p_organization_id, v_payout.id, p_financial_account_id, v_amount,
    coalesce(p_paid_on, current_date), p_payment_method,
    nullif(btrim(p_reference), ''), p_idempotency_key, auth.uid()
  ) returning id into v_settlement_id;
  update public.commission_payouts
  set status = 'PAID', paid_at = now(), marked_paid_by = auth.uid()
  where organization_id = p_organization_id and id = v_payout.id;
  return v_settlement_id;
exception when unique_violation then
  select settlement.id into v_settlement_id
  from public.commission_payout_settlements settlement
  where settlement.organization_id = p_organization_id
    and settlement.idempotency_key = p_idempotency_key;
  if v_settlement_id is not null then return v_settlement_id; end if;
  raise;
end;
$$;

revoke all on function public.pay_commission(uuid, uuid, date, date, uuid[], uuid, date, public.financial_payment_method, text, text) from public, anon, authenticated, service_role;
grant execute on function public.pay_commission(uuid, uuid, date, date, uuid[], uuid, date, public.financial_payment_method, text, text) to authenticated;
