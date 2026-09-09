-- Keep receipt, due and effective payment dates distinct for commission payouts.
alter table public.commission_payout_settlements
  add column launch_on date not null default current_date,
  add column due_on date not null default current_date;

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
    payment.kind,
    payment.occurred_at,
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
    string_agg(distinct account.name, ', ' order by account.name) financial_account_names,
    max((allocation.occurred_at at time zone 'America/Sao_Paulo')::date)
      filter (where allocation.kind in ('CAPTURE', 'ADJUSTMENT')) received_on
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
  greatest(coalesce(commission.commission_cents, 0) - coalesce(commission.paid_commission_cents, 0), 0)::bigint payable_commission_cents,
  received.received_on
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

drop function if exists public.pay_commission(uuid, uuid, date, date, uuid[], uuid, date, public.financial_payment_method, text, text);

create or replace function public.pay_commission(
  p_organization_id uuid,
  p_barber_id uuid,
  p_period_start date,
  p_period_end date,
  p_appointment_item_ids uuid[],
  p_launch_on date,
  p_due_on date,
  p_financial_account_id uuid,
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
  if p_period_start > p_period_end or p_launch_on is null or p_due_on is null or nullif(btrim(p_idempotency_key), '') is null then
    raise exception using errcode = '22023', message = 'valid period, dates and idempotency key are required';
  end if;
  select array_agg(distinct selected_id order by selected_id) into v_selected_item_ids
  from unnest(coalesce(p_appointment_item_ids, '{}'::uuid[])) selected_id where selected_id is not null;
  if coalesce(cardinality(v_selected_item_ids), 0) = 0 then
    raise exception using errcode = '22023', message = 'at least one commission must be selected';
  end if;
  perform 1 from public.barbers where organization_id = p_organization_id and id = p_barber_id and active for update;
  if not found then raise exception using errcode = 'P0002', message = 'active barber not found'; end if;
  if not exists (select 1 from public.financial_accounts where organization_id = p_organization_id and id = p_financial_account_id and active) then
    raise exception using errcode = '22023', message = 'active financial account is required';
  end if;
  select settlement.id into v_settlement_id from public.commission_payout_settlements settlement
  where settlement.organization_id = p_organization_id and settlement.idempotency_key = p_idempotency_key;
  if v_settlement_id is not null then return v_settlement_id; end if;
  select count(*)::integer into v_selected_count from public.commission_service_details detail
  where detail.organization_id = p_organization_id and detail.barber_id = p_barber_id
    and detail.service_date between p_period_start and p_period_end
    and detail.appointment_item_id = any(v_selected_item_ids) and detail.payable_commission_cents > 0;
  if v_selected_count <> cardinality(v_selected_item_ids) then
    raise exception using errcode = '22023', message = 'selected commission is not open in the requested period';
  end if;
  if exists (
    select 1 from public.commission_payout_items payout_item
    join public.commission_payouts payout on payout.organization_id = payout_item.organization_id
      and payout.id = payout_item.payout_id and payout.status = 'OPEN'
    join public.commission_ledger ledger on ledger.organization_id = payout_item.organization_id
      and ledger.id = payout_item.ledger_entry_id
    where payout_item.organization_id = p_organization_id and payout.barber_id = p_barber_id
      and ledger.appointment_item_id = any(v_selected_item_ids)
  ) then raise exception using errcode = '22023', message = 'selected commission is already reserved for payment'; end if;
  insert into public.commission_payouts (organization_id, barber_id, period_start, period_end, amount_cents)
  values (p_organization_id, p_barber_id, p_period_start, p_period_end, 0) returning * into v_payout;
  for v_ledger in
    select ledger.* from public.commission_ledger ledger
    join public.commission_service_details detail on detail.organization_id = ledger.organization_id
      and detail.appointment_id = ledger.appointment_id and detail.appointment_item_id = ledger.appointment_item_id
    where ledger.organization_id = p_organization_id and ledger.barber_id = p_barber_id
      and ledger.appointment_item_id = any(v_selected_item_ids) and detail.service_date between p_period_start and p_period_end
      and not exists (select 1 from public.commission_payout_items existing where existing.organization_id = ledger.organization_id and existing.ledger_entry_id = ledger.id)
    order by ledger.appointment_item_id, ledger.created_at, ledger.id for update of ledger
  loop
    insert into public.commission_payout_items (organization_id, payout_id, ledger_entry_id) values (p_organization_id, v_payout.id, v_ledger.id);
    v_amount := v_amount + v_ledger.amount_cents;
  end loop;
  if v_amount <= 0 then raise exception using errcode = '22023', message = 'no positive unpaid commission in selection'; end if;
  update public.commission_payouts set amount_cents = v_amount where organization_id = p_organization_id and id = v_payout.id;
  insert into public.commission_payout_settlements (
    organization_id, payout_id, financial_account_id, amount_cents, paid_on, launch_on, due_on,
    payment_method, reference, idempotency_key, created_by
  ) values (
    p_organization_id, v_payout.id, p_financial_account_id, v_amount, current_date, p_launch_on, p_due_on,
    p_payment_method, nullif(btrim(p_reference), ''), p_idempotency_key, auth.uid()
  ) returning id into v_settlement_id;
  update public.commission_payouts set status = 'PAID', paid_at = now(), marked_paid_by = auth.uid()
  where organization_id = p_organization_id and id = v_payout.id;
  return v_settlement_id;
exception when unique_violation then
  select settlement.id into v_settlement_id from public.commission_payout_settlements settlement
  where settlement.organization_id = p_organization_id and settlement.idempotency_key = p_idempotency_key;
  if v_settlement_id is not null then return v_settlement_id; end if;
  raise;
end;
$$;

revoke all on function public.pay_commission(uuid, uuid, date, date, uuid[], date, date, uuid, public.financial_payment_method, text, text) from public, anon, authenticated, service_role;
grant execute on function public.pay_commission(uuid, uuid, date, date, uuid[], date, date, uuid, public.financial_payment_method, text, text) to authenticated;
