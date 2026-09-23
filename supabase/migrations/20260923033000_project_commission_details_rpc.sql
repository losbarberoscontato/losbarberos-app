create or replace function public.get_project_commission_details(
  p_organization_id uuid,
  p_project_ids uuid[]
)
returns table (
  organization_id uuid,
  appointment_id uuid,
  appointment_item_id uuid,
  customer_id uuid,
  customer_name text,
  barber_id uuid,
  service_id uuid,
  service_name text,
  location_id uuid,
  service_date date,
  service_value_paid_cents bigint,
  financial_account_names text,
  commission_cents bigint,
  paid_commission_cents bigint,
  payable_commission_cents bigint,
  received_on date,
  project_session_id uuid,
  project_engagement_id uuid,
  project_id uuid,
  is_project boolean,
  source_type text,
  internal_service_id uuid
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
with project_appointments as (
  select distinct session.appointment_id
  from public.project_engagement_sessions session
  join public.project_engagements engagement
    on engagement.organization_id = session.organization_id
   and engagement.id = session.engagement_id
  where session.organization_id = p_organization_id
    and engagement.project_id = any (p_project_ids)
    and session.appointment_id is not null
), item_totals as (
  select item.organization_id, item.appointment_id,
    coalesce(sum(item.charged_price_cents_snapshot * item.quantity), 0)::bigint total_cents
  from public.appointment_items item
  join project_appointments project_appointment
    on project_appointment.appointment_id = item.appointment_id
  where item.organization_id = p_organization_id
  group by item.organization_id, item.appointment_id
), payment_allocations as (
  select payment.organization_id, payment.appointment_id,
    item.id appointment_item_id, payment.kind, payment.occurred_at,
    case when payment.kind in ('CAPTURE', 'ADJUSTMENT') then 1 else -1 end *
      round(payment.amount_cents::numeric * (item.charged_price_cents_snapshot * item.quantity)::numeric / nullif(total.total_cents, 0))::bigint signed_cents,
    coalesce(receipt.financial_account_id, mapping.financial_account_id) financial_account_id
  from public.payment_transactions payment
  join project_appointments project_appointment
    on project_appointment.appointment_id = payment.appointment_id
  join item_totals total
    on total.organization_id = payment.organization_id
   and total.appointment_id = payment.appointment_id
   and total.total_cents > 0
  join public.appointment_items item
    on item.organization_id = payment.organization_id
   and item.appointment_id = payment.appointment_id
  join public.appointments appointment
    on appointment.organization_id = payment.organization_id
   and appointment.id = payment.appointment_id
  left join public.appointment_receipt_classifications receipt
    on receipt.organization_id = payment.organization_id
   and receipt.payment_transaction_id = payment.id
  left join public.payment_account_mappings mapping
    on mapping.organization_id = payment.organization_id
   and mapping.provider = payment.provider
   and mapping.payment_mode = appointment.payment_mode
  where payment.organization_id = p_organization_id
    and payment.kind in ('CAPTURE', 'ADJUSTMENT', 'REFUND', 'REVERSAL')
), received_by_item as (
  select allocation.organization_id, allocation.appointment_id, allocation.appointment_item_id,
    greatest(sum(allocation.signed_cents), 0)::bigint service_value_paid_cents,
    string_agg(distinct account.name, ', ' order by account.name) financial_account_names,
    max((allocation.occurred_at at time zone 'America/Sao_Paulo')::date) filter (where allocation.kind in ('CAPTURE', 'ADJUSTMENT')) received_on
  from payment_allocations allocation
  left join public.financial_accounts account
    on account.organization_id = allocation.organization_id
   and account.id = allocation.financial_account_id
  group by allocation.organization_id, allocation.appointment_id, allocation.appointment_item_id
), ledger_totals as (
  select ledger.organization_id, ledger.appointment_id, ledger.appointment_item_id,
    sum(ledger.amount_cents)::bigint commission_cents
  from public.commission_ledger ledger
  join project_appointments project_appointment
    on project_appointment.appointment_id = ledger.appointment_id
  where ledger.organization_id = p_organization_id
  group by ledger.organization_id, ledger.appointment_id, ledger.appointment_item_id
), paid_totals as (
  select payout_item.organization_id, ledger.appointment_id, ledger.appointment_item_id,
    greatest(sum(settlement.amount_cents - coalesce(reversal.amount_cents, 0)), 0)::bigint paid_commission_cents
  from public.commission_payout_items payout_item
  join public.commission_ledger ledger
    on ledger.organization_id = payout_item.organization_id
   and ledger.id = payout_item.ledger_entry_id
  join project_appointments project_appointment
    on project_appointment.appointment_id = ledger.appointment_id
  join public.commission_payouts payout
    on payout.organization_id = payout_item.organization_id
   and payout.id = payout_item.payout_id
  join public.commission_payout_settlements settlement
    on settlement.organization_id = payout.organization_id
   and settlement.payout_id = payout.id
  left join (
    select organization_id, settlement_id, sum(amount_cents)::bigint amount_cents
    from public.commission_payout_settlement_reversals
    group by organization_id, settlement_id
  ) reversal
    on reversal.organization_id = settlement.organization_id
   and reversal.settlement_id = settlement.id
  where payout_item.organization_id = p_organization_id
  group by payout_item.organization_id, ledger.appointment_id, ledger.appointment_item_id
), completed_dates as (
  select event.organization_id, event.appointment_id,
    min((event.created_at at time zone coalesce(org.timezone, 'America/Sao_Paulo'))::date) service_date
  from public.appointment_status_events event
  join project_appointments project_appointment
    on project_appointment.appointment_id = event.appointment_id
  join public.organizations org on org.id = event.organization_id
  where event.organization_id = p_organization_id
    and event.to_status = 'COMPLETED'
  group by event.organization_id, event.appointment_id
), appointment_rows as (
  select appointment.organization_id, appointment.id appointment_id, item.id appointment_item_id,
    appointment.customer_id, customer.full_name customer_name, appointment.barber_id,
    item.service_id, item.service_name_snapshot service_name, appointment.location_id,
    coalesce(completed.service_date, lower(appointment.service_period)::date) service_date,
    coalesce(received.service_value_paid_cents, 0)::bigint service_value_paid_cents,
    received.financial_account_names, coalesce(commission.commission_cents, 0)::bigint commission_cents,
    coalesce(commission_paid.paid_commission_cents, 0)::bigint paid_commission_cents,
    greatest(coalesce(commission.commission_cents, 0) - coalesce(commission_paid.paid_commission_cents, 0), 0)::bigint payable_commission_cents,
    received.received_on, session.id project_session_id, engagement.id project_engagement_id,
    engagement.project_id, true is_project, 'APPOINTMENT'::text source_type, null::uuid internal_service_id
  from public.appointments appointment
  join project_appointments project_appointment
    on project_appointment.appointment_id = appointment.id
  join public.appointment_items item
    on item.organization_id = appointment.organization_id
   and item.appointment_id = appointment.id
  join public.customers customer
    on customer.organization_id = appointment.organization_id
   and customer.id = appointment.customer_id
  join public.project_engagement_sessions session
    on session.organization_id = appointment.organization_id
   and session.appointment_id = appointment.id
  join public.project_engagements engagement
    on engagement.organization_id = session.organization_id
   and engagement.id = session.engagement_id
   and engagement.project_id = any (p_project_ids)
  left join received_by_item received
    on received.organization_id = item.organization_id
   and received.appointment_id = item.appointment_id
   and received.appointment_item_id = item.id
  left join ledger_totals commission
    on commission.organization_id = item.organization_id
   and commission.appointment_id = item.appointment_id
   and commission.appointment_item_id = item.id
  left join paid_totals commission_paid
    on commission_paid.organization_id = item.organization_id
   and commission_paid.appointment_id = item.appointment_id
   and commission_paid.appointment_item_id = item.id
  left join completed_dates completed
    on completed.organization_id = appointment.organization_id
   and completed.appointment_id = appointment.id
  where appointment.organization_id = p_organization_id
    and appointment.status = 'COMPLETED'
), internal_rows as (
  select internal_service.organization_id, null::uuid appointment_id, null::uuid appointment_item_id,
    null::uuid customer_id, null::text customer_name, internal_service.barber_id,
    internal_service.service_id, internal_service.service_name, null::uuid location_id,
    internal_service.delivery_on service_date, 0::bigint service_value_paid_cents, null::text financial_account_names,
    coalesce(ledger_totals.commission_cents, 0)::bigint commission_cents,
    coalesce(paid_totals.paid_commission_cents, 0)::bigint paid_commission_cents,
    greatest(coalesce(ledger_totals.commission_cents, 0) - coalesce(paid_totals.paid_commission_cents, 0), 0)::bigint payable_commission_cents,
    null::date received_on, null::uuid project_session_id, internal_service.engagement_id project_engagement_id,
    internal_service.project_id, true is_project, 'PROJECT_INTERNAL'::text source_type, internal_service.id internal_service_id
  from public.project_engagement_internal_services internal_service
  left join lateral (
    select sum(ledger.amount_cents)::bigint commission_cents
    from public.commission_ledger ledger
    where ledger.organization_id = internal_service.organization_id
      and ledger.project_internal_service_id = internal_service.id
  ) ledger_totals on true
  left join lateral (
    select greatest(sum(settlement.amount_cents - coalesce(reversals.amount_cents, 0)), 0)::bigint paid_commission_cents
    from public.commission_payout_items payout_item
    join public.commission_payout_settlements settlement
      on settlement.organization_id = payout_item.organization_id
     and settlement.payout_id = payout_item.payout_id
    left join (
      select organization_id, settlement_id, sum(amount_cents)::bigint amount_cents
      from public.commission_payout_settlement_reversals
      group by organization_id, settlement_id
    ) reversals
      on reversals.organization_id = settlement.organization_id
     and reversals.settlement_id = settlement.id
    join public.commission_ledger ledger
      on ledger.organization_id = payout_item.organization_id
     and ledger.id = payout_item.ledger_entry_id
    where payout_item.organization_id = internal_service.organization_id
      and ledger.project_internal_service_id = internal_service.id
  ) paid_totals on true
  where internal_service.organization_id = p_organization_id
    and internal_service.project_id = any (p_project_ids)
    and internal_service.status = 'COMPLETED'
)
select * from appointment_rows
union all
select * from internal_rows
order by service_date desc;
$$;

revoke all on function public.get_project_commission_details(uuid, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.get_project_commission_details(uuid, uuid[]) to authenticated;
