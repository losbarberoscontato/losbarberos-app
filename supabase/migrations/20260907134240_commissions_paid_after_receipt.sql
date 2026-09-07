-- Commission becomes payable only after service completion and full receipt.
-- Appointment snapshots remain source of truth for the rule: specific service
-- snapshot already wins over professional default at booking time.

create or replace function public.appointment_is_fully_received(p_appointment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_appointment public.appointments%rowtype;
  v_expected bigint;
  v_received bigint;
begin
  select * into strict v_appointment
  from public.appointments
  where id = p_appointment_id;

  select greatest(
    coalesce((
      select adjustment.final_total_cents
      from public.appointment_amount_adjustments adjustment
      where adjustment.organization_id = v_appointment.organization_id
        and adjustment.appointment_id = v_appointment.id
      order by adjustment.created_at desc, adjustment.id desc
      limit 1
    ), v_appointment.total_cents_snapshot) - v_appointment.amount_waived_cents,
    0
  ) into v_expected;

  select coalesce(sum(
    case when payment.kind in ('CAPTURE', 'ADJUSTMENT') then payment.amount_cents
         when payment.kind in ('REFUND', 'REVERSAL') then -payment.amount_cents
         else 0 end
  ), 0)::bigint into v_received
  from public.payment_transactions payment
  where payment.organization_id = v_appointment.organization_id
    and payment.appointment_id = v_appointment.id;

  return v_received >= v_expected;
exception when no_data_found then
  return false;
end;
$$;

create or replace function public.ensure_commission_for_received_appointment(p_appointment_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_appointment public.appointments%rowtype;
  v_list_total bigint;
  v_final_total bigint;
  v_commission bigint;
  v_item public.appointment_items%rowtype;
begin
  select * into strict v_appointment
  from public.appointments
  where id = p_appointment_id
  for update;

  if v_appointment.status <> 'COMPLETED'
     or not public.appointment_is_fully_received(v_appointment.id) then
    return;
  end if;

  select coalesce(sum(item.list_price_cents_snapshot * item.quantity), 0)::bigint
    into v_list_total
  from public.appointment_items item
  where item.organization_id = v_appointment.organization_id
    and item.appointment_id = v_appointment.id;

  select greatest(
    coalesce((
      select adjustment.final_total_cents
      from public.appointment_amount_adjustments adjustment
      where adjustment.organization_id = v_appointment.organization_id
        and adjustment.appointment_id = v_appointment.id
      order by adjustment.created_at desc, adjustment.id desc
      limit 1
    ), v_appointment.total_cents_snapshot) - v_appointment.amount_waived_cents,
    0
  ) into v_final_total;

  for v_item in
    select *
    from public.appointment_items item
    where item.organization_id = v_appointment.organization_id
      and item.appointment_id = v_appointment.id
    order by item.position
  loop
    v_commission := case v_item.commission_mode_snapshot
      when 'PERCENT' then case when v_list_total > 0 then round(
        v_final_total::numeric
          * (v_item.list_price_cents_snapshot * v_item.quantity)::numeric
          / v_list_total
          * v_item.commission_percentage_bps_snapshot / 10000
      )::bigint else 0 end
      when 'FIXED' then v_item.commission_fixed_cents_snapshot * v_item.quantity
      else 0
    end;

    if v_commission > 0 then
      insert into public.commission_ledger (
        organization_id, barber_id, appointment_id, appointment_item_id,
        kind, amount_cents, idempotency_key, earned_at, created_by
      ) values (
        v_appointment.organization_id, v_appointment.barber_id,
        v_appointment.id, v_item.id, 'EARNED', v_commission,
        'earned:' || v_appointment.id || ':' || v_item.id,
        now(), auth.uid()
      ) on conflict (organization_id, idempotency_key) do nothing;
    end if;
  end loop;
exception when no_data_found then
  return;
end;
$$;

create or replace function public.guard_unreceived_commission()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.kind = 'EARNED'
     and new.source_entry_id is null
     and not public.appointment_is_fully_received(new.appointment_id) then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists commission_ledger_received_guard on public.commission_ledger;
create trigger commission_ledger_received_guard
  before insert on public.commission_ledger
  for each row execute function public.guard_unreceived_commission();

create or replace function public.award_commission_after_payment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.kind in ('CAPTURE', 'ADJUSTMENT') then
    perform public.ensure_commission_for_received_appointment(new.appointment_id);
  end if;
  return new;
end;
$$;

drop trigger if exists payment_transactions_commission_after_insert on public.payment_transactions;
create trigger payment_transactions_commission_after_insert
  after insert on public.payment_transactions
  for each row execute function public.award_commission_after_payment();

-- Details used by the manager commission screen. Values are net received,
-- allocated to service lines, and account names come from receipt mapping.
create or replace view public.commission_service_details
with (security_invoker = true) as
with item_totals as (
  select item.organization_id, item.appointment_id,
    coalesce(sum(item.charged_price_cents_snapshot * item.quantity), 0)::bigint total_cents
  from public.appointment_items item
  group by item.organization_id, item.appointment_id
), payment_allocations as (
  select payment.organization_id, payment.appointment_id,
    item.id appointment_item_id,
    case when payment.kind in ('CAPTURE', 'ADJUSTMENT') then 1 else -1 end *
      round(payment.amount_cents::numeric * (item.charged_price_cents_snapshot * item.quantity)::numeric / nullif(total.total_cents, 0))::bigint signed_cents,
    coalesce(receipt.financial_account_id, mapping.financial_account_id) financial_account_id
  from public.payment_transactions payment
  join item_totals total on total.organization_id = payment.organization_id
    and total.appointment_id = payment.appointment_id and total.total_cents > 0
  join public.appointment_items item on item.organization_id = payment.organization_id
    and item.appointment_id = payment.appointment_id
  join public.appointments appointment on appointment.organization_id = payment.organization_id
    and appointment.id = payment.appointment_id
  left join public.appointment_receipt_classifications receipt
    on receipt.organization_id = payment.organization_id
    and receipt.payment_transaction_id = payment.id
  left join public.payment_account_mappings mapping
    on mapping.organization_id = payment.organization_id
    and mapping.provider = payment.provider
    and mapping.payment_mode = appointment.payment_mode
  where payment.kind in ('CAPTURE', 'ADJUSTMENT', 'REFUND', 'REVERSAL')
), received_by_item as (
  select allocation.organization_id, allocation.appointment_id,
    allocation.appointment_item_id,
    greatest(sum(allocation.signed_cents), 0)::bigint service_value_paid_cents,
    string_agg(distinct account.name, ', ' order by account.name) financial_account_names
  from payment_allocations allocation
  left join public.financial_accounts account on account.organization_id = allocation.organization_id
    and account.id = allocation.financial_account_id
  group by allocation.organization_id, allocation.appointment_id, allocation.appointment_item_id
), commission_totals as (
  select ledger.organization_id, ledger.appointment_id, ledger.appointment_item_id,
    sum(ledger.amount_cents)::bigint commission_cents,
    coalesce(sum(ledger.amount_cents) filter (where settlement.id is not null), 0)::bigint paid_commission_cents
  from public.commission_ledger ledger
  left join public.commission_payout_items payout_item
    on payout_item.organization_id = ledger.organization_id
    and payout_item.ledger_entry_id = ledger.id
  left join public.commission_payout_settlements settlement
    on settlement.organization_id = payout_item.organization_id
    and settlement.payout_id = payout_item.payout_id
  group by ledger.organization_id, ledger.appointment_id, ledger.appointment_item_id
), completed_dates as (
  select event.organization_id, event.appointment_id,
    min((event.created_at at time zone coalesce(org.timezone, 'America/Sao_Paulo'))::date) service_date
  from public.appointment_status_events event
  join public.organizations org on org.id = event.organization_id
  where event.to_status = 'COMPLETED'
  group by event.organization_id, event.appointment_id
)
select appointment.organization_id,
  appointment.id appointment_id,
  item.id appointment_item_id,
  appointment.customer_id,
  customer.full_name customer_name,
  appointment.barber_id,
  item.service_id,
  item.service_name_snapshot service_name,
  appointment.location_id,
  coalesce(completed.service_date, lower(appointment.service_period)::date) service_date,
  coalesce(received.service_value_paid_cents, 0)::bigint service_value_paid_cents,
  received.financial_account_names,
  coalesce(commission.commission_cents, 0)::bigint commission_cents,
  coalesce(commission.paid_commission_cents, 0)::bigint paid_commission_cents,
  greatest(coalesce(commission.commission_cents, 0) - coalesce(commission.paid_commission_cents, 0), 0)::bigint payable_commission_cents
from public.appointments appointment
join public.appointment_items item on item.organization_id = appointment.organization_id
  and item.appointment_id = appointment.id
join public.customers customer on customer.organization_id = appointment.organization_id
  and customer.id = appointment.customer_id
left join received_by_item received on received.organization_id = item.organization_id
  and received.appointment_id = item.appointment_id and received.appointment_item_id = item.id
left join commission_totals commission on commission.organization_id = item.organization_id
  and commission.appointment_id = item.appointment_id and commission.appointment_item_id = item.id
left join completed_dates completed on completed.organization_id = appointment.organization_id
  and completed.appointment_id = appointment.id
where appointment.status = 'COMPLETED';

grant select on public.commission_service_details to authenticated;

-- Payment settlement is a cash outflow. Include it in account balances so
-- “Pagar Comissão” changes Caixa and the balance cards atomically.
create or replace view public.financial_account_balances
with (security_invoker = true) as
with movements as (
  select settlement.organization_id, settlement.financial_account_id,
    case
      when entry.kind = 'REVENUE' and settlement.kind = 'SETTLEMENT' then settlement.amount_cents
      when entry.kind = 'REVENUE' and settlement.kind = 'REVERSAL' then -settlement.amount_cents
      when entry.kind = 'EXPENSE' and settlement.kind = 'SETTLEMENT' then -settlement.amount_cents
      else settlement.amount_cents
    end::bigint signed_cents
  from public.financial_settlements settlement
  join public.financial_entries entry on entry.id = settlement.entry_id and entry.organization_id = settlement.organization_id
  union all
  select organization_id, financial_account_id, signed_cents
  from public.appointment_cash_activity
  where financial_account_id is not null
  union all
  select organization_id, source_financial_account_id, -amount_cents::bigint
  from public.financial_transfers
  union all
  select organization_id, destination_financial_account_id, amount_cents::bigint
  from public.financial_transfers
  union all
  select organization_id, financial_account_id, -amount_cents::bigint
  from public.commission_payout_settlements
)
select account.organization_id, account.id financial_account_id, account.opening_balance_cents,
  coalesce(sum(movement.signed_cents), 0)::bigint movement_cents,
  (account.opening_balance_cents + coalesce(sum(movement.signed_cents), 0))::bigint balance_cents
from public.financial_accounts account
left join movements movement on movement.organization_id = account.organization_id
  and movement.financial_account_id = account.id
group by account.organization_id, account.id, account.opening_balance_cents;

create or replace function public.pay_commission(
  p_organization_id uuid,
  p_barber_id uuid,
  p_period_start date,
  p_period_end date,
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
  v_amount bigint;
begin
  perform public.require_financial_owner(p_organization_id, 'commission payout');
  if p_period_start > p_period_end or nullif(btrim(p_idempotency_key), '') is null then
    raise exception using errcode = '22023', message = 'valid period and idempotency key are required';
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

  select * into v_payout
  from public.commission_payouts payout
  where payout.organization_id = p_organization_id
    and payout.barber_id = p_barber_id
    and payout.period_start = p_period_start
    and payout.period_end = p_period_end
    and payout.status = 'OPEN'
  order by payout.created_at desc
  limit 1
  for update;

  if not found then
    select coalesce(sum(detail.payable_commission_cents), 0)::bigint into v_amount
    from public.commission_service_details detail
    where detail.organization_id = p_organization_id
      and detail.barber_id = p_barber_id
      and detail.service_date between p_period_start and p_period_end;
    if v_amount <= 0 then
      raise exception using errcode = '22023', message = 'no positive unpaid commission in period';
    end if;
    insert into public.commission_payouts (organization_id, barber_id, period_start, period_end, amount_cents)
    values (p_organization_id, p_barber_id, p_period_start, p_period_end, v_amount)
    returning * into v_payout;
    insert into public.commission_payout_items (organization_id, payout_id, ledger_entry_id)
    select ledger.organization_id, v_payout.id, ledger.id
    from public.commission_ledger ledger
    join public.commission_service_details detail on detail.organization_id = ledger.organization_id
      and detail.appointment_id = ledger.appointment_id
      and detail.appointment_item_id = ledger.appointment_item_id
    where ledger.organization_id = p_organization_id
      and ledger.barber_id = p_barber_id
      and detail.service_date between p_period_start and p_period_end
      and not exists (
        select 1 from public.commission_payout_items existing
        where existing.organization_id = ledger.organization_id and existing.ledger_entry_id = ledger.id
      );
  end if;

  if v_payout.status <> 'OPEN' then
    raise exception using errcode = '22023', message = 'payout is not open';
  end if;
  insert into public.commission_payout_settlements (
    organization_id, payout_id, financial_account_id, amount_cents, paid_on,
    payment_method, reference, idempotency_key, created_by
  ) values (
    p_organization_id, v_payout.id, p_financial_account_id,
    v_payout.amount_cents, coalesce(p_paid_on, current_date), p_payment_method,
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

revoke all on function public.appointment_is_fully_received(uuid) from public, anon, authenticated, service_role;
revoke all on function public.ensure_commission_for_received_appointment(uuid) from public, anon, authenticated, service_role;
revoke all on function public.guard_unreceived_commission() from public, anon, authenticated, service_role;
revoke all on function public.award_commission_after_payment() from public, anon, authenticated, service_role;
revoke all on function public.pay_commission(uuid,uuid,date,date,uuid,date,public.financial_payment_method,text,text) from public, anon, authenticated, service_role;
grant execute on function public.pay_commission(uuid,uuid,date,date,uuid,date,public.financial_payment_method,text,text) to authenticated;
