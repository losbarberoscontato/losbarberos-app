-- Sessões operacionais de contratos e comissão definida no pacote.
alter type public.booking_source add value if not exists 'PROJECT';

create table public.project_engagement_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  engagement_id uuid not null,
  session_number integer not null check (session_number > 0),
  status text not null default 'OPEN' check (status in ('OPEN', 'BOOKED', 'COMPLETED', 'CANCELED')),
  appointment_id uuid,
  service_id uuid,
  barber_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (engagement_id, session_number),
  unique (appointment_id),
  unique (id, organization_id),
  foreign key (engagement_id, organization_id)
    references public.project_engagements(id, organization_id) on delete cascade,
  foreign key (appointment_id, organization_id)
    references public.appointments(id, organization_id),
  foreign key (service_id, organization_id)
    references public.services(id, organization_id),
  foreign key (barber_id, organization_id)
    references public.barbers(id, organization_id)
);

create index project_engagement_sessions_lookup_idx
  on public.project_engagement_sessions (organization_id, engagement_id, session_number);

alter table public.project_engagement_sessions enable row level security;
alter table public.project_engagement_sessions force row level security;
create policy project_engagement_sessions_owner_all
  on public.project_engagement_sessions
  for all to authenticated
  using (public.is_organization_owner(organization_id))
  with check (public.is_organization_owner(organization_id));
revoke all on public.project_engagement_sessions from public, anon;
grant select on public.project_engagement_sessions to authenticated;

create or replace function public.sync_project_engagement_sessions()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sessions integer;
begin
  if new.status = 'ACTIVE' then
    select sessions_count into v_sessions
    from public.project_packages
    where id = new.package_id and organization_id = new.organization_id;

    insert into public.project_engagement_sessions (
      organization_id, engagement_id, session_number
    )
    select new.organization_id, new.id, generated.session_number
    from generate_series(1, greatest(coalesce(v_sessions, 1), 1)) generated(session_number)
    on conflict (engagement_id, session_number) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists project_engagement_sessions_sync on public.project_engagements;
create trigger project_engagement_sessions_sync
  after insert or update of status, package_id on public.project_engagements
  for each row execute function public.sync_project_engagement_sessions();

create or replace function public.sync_project_session_from_appointment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.source = 'PROJECT' then
    update public.project_engagement_sessions
    set status = case
          when new.status = 'COMPLETED' then 'COMPLETED'
          when new.status = 'CANCELED' and coalesce(new.cancellation_outcome, 'AFTER_DEADLINE') = 'ON_TIME' then 'OPEN'
          when new.status = 'CANCELED' then 'CANCELED'
          else 'BOOKED'
        end,
        appointment_id = case when new.status = 'CANCELED' and coalesce(new.cancellation_outcome, 'AFTER_DEADLINE') = 'ON_TIME' then null else appointment_id end,
        service_id = case when new.status = 'CANCELED' and coalesce(new.cancellation_outcome, 'AFTER_DEADLINE') = 'ON_TIME' then null else service_id end,
        barber_id = case when new.status = 'CANCELED' and coalesce(new.cancellation_outcome, 'AFTER_DEADLINE') = 'ON_TIME' then null else barber_id end,
        updated_at = now()
    where organization_id = new.organization_id and appointment_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists project_session_appointment_sync on public.appointments;
create trigger project_session_appointment_sync
  after update of status, cancellation_outcome on public.appointments
  for each row execute function public.sync_project_session_from_appointment();

create or replace function public.create_project_appointment(
  p_organization_id uuid,
  p_session_id uuid,
  p_barber_id uuid,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_environment_id uuid,
  p_override_reason text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_org public.organizations%rowtype;
  v_session public.project_engagement_sessions%rowtype;
  v_engagement public.project_engagements%rowtype;
  v_package public.project_packages%rowtype;
  v_service public.services%rowtype;
  v_barber public.barbers%rowtype;
  v_assignment public.project_package_service_assignments%rowtype;
  v_customer_id uuid;
  v_period tstzrange;
  v_occupied integer;
  v_appointment_id uuid;
  v_local_start timestamp;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization owner required';
  end if;
  select * into strict v_session
  from public.project_engagement_sessions
  where id = p_session_id and organization_id = p_organization_id
  for update;
  if v_session.status <> 'OPEN' or v_session.appointment_id is not null then
    raise exception using errcode = '40001', message = 'project session is not available';
  end if;
  select * into strict v_engagement
  from public.project_engagements
  where id = v_session.engagement_id and organization_id = p_organization_id;
  if v_engagement.status <> 'ACTIVE' then
    raise exception using errcode = '22023', message = 'project contract is not active';
  end if;
  select * into strict v_package
  from public.project_packages
  where id = v_engagement.package_id and organization_id = p_organization_id and active;
  select * into strict v_assignment
  from public.project_package_service_assignments
  where organization_id = p_organization_id
    and project_package_id = v_package.id
    and service_id = p_service_id
    and barber_id = p_barber_id;
  select * into strict v_service from public.services
  where id = p_service_id and organization_id = p_organization_id and active;
  select * into strict v_barber from public.barbers
  where id = p_barber_id and organization_id = p_organization_id and active;
  select customer_id into v_customer_id from public.project_engagements
  where id = v_engagement.id and organization_id = p_organization_id;
  if p_starts_at <= now() then
    raise exception using errcode = '22023', message = 'appointment start must be in the future';
  end if;
  select * into strict v_org from public.organizations where id = p_organization_id;
  v_local_start := p_starts_at at time zone v_org.timezone;
  if extract(second from v_local_start) <> 0
     or mod(extract(minute from v_local_start)::integer, v_org.slot_interval_minutes) <> 0 then
    raise exception using errcode = '22023', message = 'start time is not aligned to slot interval';
  end if;
  perform set_config('app.agenda_environment_id', coalesce(p_environment_id::text, ''), true);
  v_occupied := ceil(v_service.duration_minutes::numeric / v_org.slot_interval_minutes)::integer * v_org.slot_interval_minutes;
  v_period := tstzrange(p_starts_at, p_starts_at + make_interval(mins => v_occupied), '[)');
  if not public.is_barber_available(p_organization_id, p_barber_id, v_period)
     and nullif(btrim(p_override_reason), '') is null then
    raise exception using errcode = '22023', message = 'override reason required outside barber schedule';
  end if;
  insert into public.appointments (
    organization_id, location_id, customer_id, barber_id, status, source,
    service_period, payment_mode, currency, total_cents_snapshot,
    list_total_cents_snapshot, deposit_bps_snapshot,
    deposit_required_cents_snapshot, cancellation_lead_minutes_snapshot,
    schedule_override_reason, notes, created_by
  ) values (
    p_organization_id, v_barber.location_id, v_customer_id, p_barber_id,
    'CONFIRMED', 'PROJECT', v_period, 'COUNTER', v_org.currency, 0, 0,
    v_org.deposit_bps, 0, v_org.cancellation_lead_minutes,
    nullif(btrim(p_override_reason), ''), p_notes, auth.uid()
  ) returning id into v_appointment_id;

  insert into public.appointment_items (
    organization_id, appointment_id, selection_key, source, service_id,
    service_name_snapshot, quantity, charged_price_cents_snapshot,
    list_price_cents_snapshot, duration_minutes_snapshot,
    commission_mode_snapshot, commission_fixed_cents_snapshot, position
  ) values (
    p_organization_id, v_appointment_id, p_service_id, 'SERVICE', p_service_id,
    v_service.name, 1, 0, v_service.price_cents, v_service.duration_minutes,
    'FIXED', v_assignment.commission_cents, 0
  );
  update public.project_engagement_sessions
  set appointment_id = v_appointment_id, service_id = p_service_id,
      barber_id = p_barber_id, status = 'BOOKED', updated_at = now()
  where id = p_session_id and organization_id = p_organization_id;
  insert into public.appointment_status_events (
    organization_id, appointment_id, to_status, reason, actor_user_id, metadata
  ) values (
    p_organization_id, v_appointment_id, 'CONFIRMED', 'project_session_booking', auth.uid(),
    jsonb_build_object('project_session_id', p_session_id, 'project_engagement_id', v_engagement.id)
  );
  return v_appointment_id;
exception
  when exclusion_violation then
    raise exception using errcode = '23P01', message = 'requested slot is no longer available';
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'project session, service or professional not found';
end;
$$;

revoke all on function public.create_project_appointment(uuid, uuid, uuid, uuid, timestamptz, uuid, text, text) from public, anon;
grant execute on function public.create_project_appointment(uuid, uuid, uuid, uuid, timestamptz, uuid, text, text) to authenticated;

create or replace view public.commission_service_details
with (security_invoker = true) as
with item_totals as (
  select item.organization_id, item.appointment_id,
    coalesce(sum(item.charged_price_cents_snapshot * item.quantity), 0)::bigint total_cents
  from public.appointment_items item
  group by item.organization_id, item.appointment_id
), payment_allocations as (
  select payment.organization_id, payment.appointment_id,
    item.id appointment_item_id, payment.kind, payment.occurred_at,
    case when payment.kind in ('CAPTURE', 'ADJUSTMENT') then 1 else -1 end *
      round(payment.amount_cents::numeric * (item.charged_price_cents_snapshot * item.quantity)::numeric / nullif(total.total_cents, 0))::bigint signed_cents,
    coalesce(receipt.financial_account_id, mapping.financial_account_id) financial_account_id
  from public.payment_transactions payment
  join item_totals total on total.organization_id = payment.organization_id
    and total.appointment_id = payment.appointment_id and total.total_cents > 0
  join public.appointment_items item on item.organization_id = payment.organization_id and item.appointment_id = payment.appointment_id
  join public.appointments appointment on appointment.organization_id = payment.organization_id and appointment.id = payment.appointment_id
  left join public.appointment_receipt_classifications receipt on receipt.organization_id = payment.organization_id and receipt.payment_transaction_id = payment.id
  left join public.payment_account_mappings mapping on mapping.organization_id = payment.organization_id and mapping.provider = payment.provider and mapping.payment_mode = appointment.payment_mode
  where payment.kind in ('CAPTURE', 'ADJUSTMENT', 'REFUND', 'REVERSAL')
), received_by_item as (
  select allocation.organization_id, allocation.appointment_id, allocation.appointment_item_id,
    greatest(sum(allocation.signed_cents), 0)::bigint service_value_paid_cents,
    string_agg(distinct account.name, ', ' order by account.name) financial_account_names,
    max((allocation.occurred_at at time zone 'America/Sao_Paulo')::date) filter (where allocation.kind in ('CAPTURE', 'ADJUSTMENT')) received_on
  from payment_allocations allocation
  left join public.financial_accounts account on account.organization_id = allocation.organization_id and account.id = allocation.financial_account_id
  group by allocation.organization_id, allocation.appointment_id, allocation.appointment_item_id
), ledger_totals as (
  select ledger.organization_id, ledger.appointment_id, ledger.appointment_item_id, sum(ledger.amount_cents)::bigint commission_cents
  from public.commission_ledger ledger group by ledger.organization_id, ledger.appointment_id, ledger.appointment_item_id
), paid_totals as (
  select payout_item.organization_id, ledger.appointment_id, ledger.appointment_item_id,
    greatest(sum(settlement.amount_cents - coalesce(reversal.amount_cents, 0)), 0)::bigint paid_commission_cents
  from public.commission_payout_items payout_item
  join public.commission_ledger ledger on ledger.organization_id = payout_item.organization_id and ledger.id = payout_item.ledger_entry_id
  join public.commission_payouts payout on payout.organization_id = payout_item.organization_id and payout.id = payout_item.payout_id
  join public.commission_payout_settlements settlement on settlement.organization_id = payout.organization_id and settlement.payout_id = payout.id
  left join (select organization_id, settlement_id, sum(amount_cents)::bigint amount_cents from public.commission_payout_settlement_reversals group by organization_id, settlement_id) reversal
    on reversal.organization_id = settlement.organization_id and reversal.settlement_id = settlement.id
  group by payout_item.organization_id, ledger.appointment_id, ledger.appointment_item_id
), commission_totals as (
  select totals.organization_id, totals.appointment_id, totals.appointment_item_id, totals.commission_cents,
    coalesce(paid.paid_commission_cents, 0)::bigint paid_commission_cents
  from ledger_totals totals left join paid_totals paid on paid.organization_id = totals.organization_id and paid.appointment_id = totals.appointment_id and paid.appointment_item_id = totals.appointment_item_id
), completed_dates as (
  select event.organization_id, event.appointment_id,
    min((event.created_at at time zone coalesce(org.timezone, 'America/Sao_Paulo'))::date) service_date
  from public.appointment_status_events event join public.organizations org on org.id = event.organization_id
  where event.to_status = 'COMPLETED' group by event.organization_id, event.appointment_id
)
select appointment.organization_id, appointment.id appointment_id, item.id appointment_item_id,
  appointment.customer_id, customer.full_name customer_name, appointment.barber_id,
  item.service_id, item.service_name_snapshot service_name, appointment.location_id,
  coalesce(completed.service_date, lower(appointment.service_period)::date) service_date,
  coalesce(received.service_value_paid_cents, 0)::bigint service_value_paid_cents,
  received.financial_account_names, coalesce(commission.commission_cents, 0)::bigint commission_cents,
  coalesce(commission.paid_commission_cents, 0)::bigint paid_commission_cents,
  greatest(coalesce(commission.commission_cents, 0) - coalesce(commission.paid_commission_cents, 0), 0)::bigint payable_commission_cents,
  received.received_on, session.id project_session_id, engagement.id project_engagement_id,
  engagement.project_id project_id, (session.id is not null) is_project
from public.appointments appointment
join public.appointment_items item on item.organization_id = appointment.organization_id and item.appointment_id = appointment.id
join public.customers customer on customer.organization_id = appointment.organization_id and customer.id = appointment.customer_id
left join received_by_item received on received.organization_id = item.organization_id and received.appointment_id = item.appointment_id and received.appointment_item_id = item.id
left join commission_totals commission on commission.organization_id = item.organization_id and commission.appointment_id = item.appointment_id and commission.appointment_item_id = item.id
left join completed_dates completed on completed.organization_id = appointment.organization_id and completed.appointment_id = appointment.id
left join public.project_engagement_sessions session on session.organization_id = appointment.organization_id and session.appointment_id = appointment.id
left join public.project_engagements engagement on engagement.organization_id = session.organization_id and engagement.id = session.engagement_id
where appointment.status = 'COMPLETED';

grant select on public.commission_service_details to authenticated;
