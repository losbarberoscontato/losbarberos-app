-- Serviços internos acompanham a passagem do cartão por quadro; não criam agenda.
create table public.project_engagement_internal_services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  engagement_id uuid not null,
  kanban_board_id uuid not null,
  package_assignment_id uuid not null,
  service_id uuid not null,
  service_name text not null,
  barber_id uuid not null,
  commission_cents bigint not null check (commission_cents >= 0),
  delivery_on date,
  status text not null default 'OPEN' check (status in ('OPEN', 'COMPLETED')),
  commission_ledger_entry_id uuid,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (engagement_id, kanban_board_id),
  foreign key (project_id, organization_id) references public.projects(id, organization_id) on delete cascade,
  foreign key (engagement_id, organization_id) references public.project_engagements(id, organization_id) on delete cascade,
  foreign key (service_id, organization_id) references public.services(id, organization_id) on delete restrict,
  foreign key (barber_id, organization_id) references public.barbers(id, organization_id) on delete restrict,
  check (status = 'COMPLETED' or commission_ledger_entry_id is null),
  check (status <> 'COMPLETED' or delivery_on is not null)
);

create index project_engagement_internal_services_project_idx
  on public.project_engagement_internal_services (organization_id, project_id, status, delivery_on);
alter table public.project_engagement_internal_services enable row level security;
alter table public.project_engagement_internal_services force row level security;
create policy project_engagement_internal_services_owner_select
  on public.project_engagement_internal_services for select to authenticated
  using (public.is_organization_owner(organization_id));
revoke all on public.project_engagement_internal_services from public, anon, authenticated;
grant select on public.project_engagement_internal_services to authenticated;

create or replace function public.guard_project_engagement_internal_service_move()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.kanban_board_id is distinct from old.kanban_board_id and exists (
    select 1 from public.project_engagement_internal_services internal_service
    where internal_service.organization_id = old.organization_id
      and internal_service.engagement_id = old.id
      and internal_service.kanban_board_id = old.kanban_board_id
      and internal_service.status = 'OPEN'
  ) then
    raise exception using errcode = '22023', message = 'complete the internal service before moving this card to another board';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_project_engagement_internal_service_move() from public, anon, authenticated, service_role;
create trigger project_engagement_internal_service_move_guard
before update of kanban_board_id on public.project_engagements
for each row execute function public.guard_project_engagement_internal_service_move();

create or replace function public.guard_project_internal_service_responsible_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.responsible_barber_id is distinct from old.responsible_barber_id and exists (
    select 1 from public.project_engagement_internal_services internal_service
    where internal_service.organization_id = old.organization_id
      and internal_service.kanban_board_id = old.id and internal_service.status = 'OPEN'
  ) then
    raise exception using errcode = '22023', message = 'complete open internal services before changing the board responsible';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_project_internal_service_responsible_change() from public, anon, authenticated, service_role;
create trigger project_internal_service_responsible_guard
before update of responsible_barber_id on public.project_kanban_boards
for each row execute function public.guard_project_internal_service_responsible_change();

create or replace function public.assert_project_internal_service_commission()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'COMPLETED' and new.commission_cents > 0 and not exists (
    select 1 from public.commission_ledger ledger
    where ledger.organization_id = new.organization_id
      and ledger.id = new.commission_ledger_entry_id
      and ledger.project_internal_service_id = new.id
      and ledger.barber_id = new.barber_id
      and ledger.kind = 'EARNED'
      and ledger.amount_cents = new.commission_cents
  ) then
    raise exception using errcode = '23514', message = 'completed internal service requires its matching earned commission';
  end if;
  return null;
end;
$$;
revoke all on function public.assert_project_internal_service_commission() from public, anon, authenticated, service_role;
create constraint trigger project_internal_service_commission_guard
after insert or update on public.project_engagement_internal_services
deferrable initially deferred
for each row execute function public.assert_project_internal_service_commission();

alter table public.commission_ledger alter column appointment_id drop not null;
alter table public.commission_ledger add column project_internal_service_id uuid;
alter table public.commission_ledger
  add constraint commission_ledger_project_internal_service_fk
  foreign key (project_internal_service_id, organization_id)
  references public.project_engagement_internal_services(id, organization_id);
alter table public.commission_ledger
  add constraint commission_ledger_earned_source_check
  check (kind <> 'EARNED' or (
    (project_internal_service_id is null and appointment_id is not null)
    or (project_internal_service_id is not null and appointment_id is null and appointment_item_id is null)
  ));
create unique index commission_ledger_internal_service_earned_key
  on public.commission_ledger (organization_id, project_internal_service_id)
  where kind = 'EARNED' and project_internal_service_id is not null;

create or replace function public.guard_unreceived_commission()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.kind = 'EARNED' and new.source_entry_id is null then
    if new.project_internal_service_id is not null then
      if not exists (
        select 1 from public.project_engagement_internal_services internal_service
        where internal_service.organization_id = new.organization_id
          and internal_service.id = new.project_internal_service_id
          and internal_service.status = 'COMPLETED'
      ) then return null; end if;
    elsif new.idempotency_key like 'earned:%'
      and not public.appointment_is_fully_received(new.appointment_id) then
      return null;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_unreceived_commission() from public, anon, authenticated, service_role;

create or replace function public.upsert_project_engagement_internal_service(
  p_organization_id uuid, p_project_id uuid, p_engagement_id uuid, p_board_id uuid,
  p_id uuid, p_service_assignment_id uuid, p_commission_cents bigint, p_delivery_on date
)
returns public.project_engagement_internal_services
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_engagement public.project_engagements%rowtype;
  v_board public.project_kanban_boards%rowtype;
  v_assignment public.project_package_service_assignments%rowtype;
  v_service public.services%rowtype;
  v_result public.project_engagement_internal_services%rowtype;
begin
  perform public.require_financial_owner(p_organization_id, 'project internal service');
  select * into v_engagement from public.project_engagements
    where organization_id = p_organization_id and project_id = p_project_id and id = p_engagement_id for update;
  if not found or v_engagement.kanban_board_id is distinct from p_board_id then
    raise exception using errcode = 'P0002', message = 'engagement is not in the selected board';
  end if;
  select * into v_board from public.project_kanban_boards
    where organization_id = p_organization_id and project_id = p_project_id and id = p_board_id and active;
  if not found then raise exception using errcode = 'P0002', message = 'active project board not found'; end if;
  if p_id is null then
    if exists (select 1 from public.project_engagement_internal_services
      where organization_id = p_organization_id and engagement_id = p_engagement_id and status = 'OPEN') then
      raise exception using errcode = '22023', message = 'complete the current internal service before adding another';
    end if;
    select * into v_assignment from public.project_package_service_assignments
      where organization_id = p_organization_id and project_package_id = v_engagement.package_id
        and id = p_service_assignment_id and barber_id = v_board.responsible_barber_id;
    if not found then raise exception using errcode = '22023', message = 'service is not assigned to this package professional'; end if;
    select * into v_service from public.services where organization_id = p_organization_id and id = v_assignment.service_id and active;
    if not found then raise exception using errcode = 'P0002', message = 'active service not found'; end if;
    insert into public.project_engagement_internal_services (
      organization_id, project_id, engagement_id, kanban_board_id, package_assignment_id,
      service_id, service_name, barber_id, commission_cents, delivery_on
    ) values (
      p_organization_id, p_project_id, p_engagement_id, p_board_id, v_assignment.id,
      v_service.id, v_service.name, v_board.responsible_barber_id, v_assignment.commission_cents, p_delivery_on
    ) returning * into v_result;
  else
    select * into v_result from public.project_engagement_internal_services
      where organization_id = p_organization_id and project_id = p_project_id
        and engagement_id = p_engagement_id and kanban_board_id = p_board_id and id = p_id for update;
    if not found or v_result.status <> 'OPEN' then
      raise exception using errcode = '22023', message = 'completed internal service cannot be changed';
    end if;
    if p_service_assignment_id <> v_result.package_assignment_id then
      raise exception using errcode = '22023', message = 'service assignment cannot be changed after creation';
    end if;
    update public.project_engagement_internal_services set commission_cents = p_commission_cents,
      delivery_on = p_delivery_on, updated_at = now()
      where organization_id = p_organization_id and id = p_id returning * into v_result;
  end if;
  return v_result;
end;
$$;

create or replace function public.complete_project_engagement_internal_service(
  p_organization_id uuid, p_internal_service_id uuid, p_idempotency_key text
)
returns public.project_engagement_internal_services
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_service public.project_engagement_internal_services%rowtype;
  v_engagement public.project_engagements%rowtype;
  v_ledger_id uuid;
  v_key text;
begin
  perform public.require_financial_owner(p_organization_id, 'complete project internal service');
  select * into v_service from public.project_engagement_internal_services
    where organization_id = p_organization_id and id = p_internal_service_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'project internal service not found'; end if;
  if v_service.status = 'COMPLETED' then return v_service; end if;
  select * into v_engagement from public.project_engagements
    where organization_id = p_organization_id and id = v_service.engagement_id for update;
  if not found or v_engagement.kanban_board_id is distinct from v_service.kanban_board_id then
    raise exception using errcode = '22023', message = 'move the engagement to another board before completing this service';
  end if;
  if v_service.delivery_on is null then raise exception using errcode = '22023', message = 'delivery date is required before completion'; end if;
  if v_service.commission_cents < 0 then raise exception using errcode = '22023', message = 'commission cannot be negative'; end if;
  update public.project_engagement_internal_services set status = 'COMPLETED', updated_at = now()
    where organization_id = p_organization_id and id = p_internal_service_id returning * into v_service;
  if v_service.commission_cents > 0 then
    v_key := 'project-internal-service:' || v_service.id || ':commission:v1';
    if p_idempotency_key is distinct from v_key then
      raise exception using errcode = '22023', message = 'invalid internal service idempotency key';
    end if;
    insert into public.commission_ledger (
      organization_id, barber_id, appointment_id, appointment_item_id, project_internal_service_id,
      kind, amount_cents, idempotency_key, earned_at, created_by
    ) values (
      p_organization_id, v_service.barber_id, null, null, v_service.id,
      'EARNED', v_service.commission_cents, v_key,
      v_service.delivery_on::timestamp at time zone 'America/Sao_Paulo', auth.uid()
    ) on conflict (organization_id, idempotency_key) do nothing returning id into v_ledger_id;
    if v_ledger_id is null then
      select id into v_ledger_id from public.commission_ledger where organization_id = p_organization_id and idempotency_key = v_key;
    end if;
    update public.project_engagement_internal_services set commission_ledger_entry_id = v_ledger_id
      where organization_id = p_organization_id and id = p_internal_service_id returning * into v_service;
  end if;
  return v_service;
end;
$$;

revoke all on function public.upsert_project_engagement_internal_service(uuid, uuid, uuid, uuid, uuid, uuid, bigint, date) from public, anon, authenticated, service_role;
grant execute on function public.upsert_project_engagement_internal_service(uuid, uuid, uuid, uuid, uuid, uuid, bigint, date) to authenticated;
revoke all on function public.complete_project_engagement_internal_service(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.complete_project_engagement_internal_service(uuid, uuid, text) to authenticated;

-- Extend the existing commission report without changing appointment rows.
alter view public.commission_service_details rename to commission_service_appointment_details;
create view public.commission_service_details with (security_invoker = true) as
select appointment_detail.organization_id, appointment_detail.appointment_id,
  appointment_detail.appointment_item_id, appointment_detail.customer_id, appointment_detail.customer_name,
  appointment_detail.barber_id, appointment_detail.service_id, appointment_detail.service_name,
  appointment_detail.location_id, appointment_detail.service_date, appointment_detail.service_value_paid_cents,
  appointment_detail.financial_account_names, appointment_detail.commission_cents,
  appointment_detail.paid_commission_cents, appointment_detail.payable_commission_cents,
  appointment_detail.received_on, appointment_detail.project_session_id, appointment_detail.project_engagement_id,
  appointment_detail.project_id, appointment_detail.is_project,
  'APPOINTMENT'::text source_type, null::uuid internal_service_id
from public.commission_service_appointment_details appointment_detail
union all
select internal_service.organization_id, null::uuid appointment_id, null::uuid appointment_item_id,
  null::uuid customer_id, null::text customer_name, internal_service.barber_id,
  internal_service.service_id, internal_service.service_name, null::uuid location_id,
  internal_service.delivery_on service_date, 0::bigint service_value_paid_cents, null::text financial_account_names,
  coalesce(ledger_totals.commission_cents, 0)::bigint commission_cents,
  coalesce(paid_totals.paid_commission_cents, 0)::bigint paid_commission_cents,
  greatest(coalesce(ledger_totals.commission_cents, 0) - coalesce(paid_totals.paid_commission_cents, 0), 0)::bigint payable_commission_cents,
  null::date received_on, null::uuid project_session_id, internal_service.engagement_id project_engagement_id,
  internal_service.project_id, true is_project, 'PROJECT_INTERNAL'::text source_type,
  internal_service.id internal_service_id
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
    on settlement.organization_id = payout_item.organization_id and settlement.payout_id = payout_item.payout_id
  left join (
    select organization_id, settlement_id, sum(amount_cents)::bigint amount_cents
    from public.commission_payout_settlement_reversals group by organization_id, settlement_id
  ) reversals on reversals.organization_id = settlement.organization_id and reversals.settlement_id = settlement.id
  join public.commission_ledger ledger on ledger.organization_id = payout_item.organization_id
    and ledger.id = payout_item.ledger_entry_id
  where payout_item.organization_id = internal_service.organization_id
    and ledger.project_internal_service_id = internal_service.id
) paid_totals on true
where internal_service.status = 'COMPLETED';
grant select on public.commission_service_details to authenticated;

-- Existing payment workflow accepts appointment-item IDs. For internal rows the
-- same parameter carries the internal-service ID; all payout writes stay shared.
drop function if exists public.pay_commission(uuid, uuid, date, date, uuid[], date, date, uuid, public.financial_payment_method, text, text, text, text);
create or replace function public.pay_commission(
  p_organization_id uuid, p_barber_id uuid, p_period_start date, p_period_end date,
  p_appointment_item_ids uuid[], p_launch_on date, p_due_on date, p_financial_account_id uuid,
  p_payment_method public.financial_payment_method, p_document_number text,
  p_tags text, p_reference text, p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_payout public.commission_payouts%rowtype;
  v_settlement_id uuid;
  v_ledger public.commission_ledger%rowtype;
  v_selected_item_ids uuid[];
  v_selected_count integer;
  v_amount bigint := 0;
begin
  perform public.require_financial_owner(p_organization_id, 'commission payout');
  if p_period_start > p_period_end or p_launch_on is null or p_due_on is null
    or nullif(btrim(p_document_number), '') is null or nullif(btrim(p_idempotency_key), '') is null then
    raise exception using errcode = '22023', message = 'valid period, dates, document number and idempotency key are required';
  end if;
  select array_agg(distinct selected_id order by selected_id) into v_selected_item_ids
  from unnest(coalesce(p_appointment_item_ids, '{}'::uuid[])) selected_id where selected_id is not null;
  if coalesce(cardinality(v_selected_item_ids), 0) = 0 then raise exception using errcode = '22023', message = 'at least one commission must be selected'; end if;
  perform 1 from public.barbers where organization_id = p_organization_id and id = p_barber_id and active for update;
  if not found then raise exception using errcode = 'P0002', message = 'active barber not found'; end if;
  if not exists (select 1 from public.financial_accounts where organization_id = p_organization_id and id = p_financial_account_id and active) then
    raise exception using errcode = '22023', message = 'active financial account is required'; end if;
  select settlement.id into v_settlement_id from public.commission_payout_settlements settlement
  where settlement.organization_id = p_organization_id and settlement.idempotency_key = p_idempotency_key;
  if v_settlement_id is not null then return v_settlement_id; end if;
  select count(*)::integer into v_selected_count from public.commission_service_details detail
  where detail.organization_id = p_organization_id and detail.barber_id = p_barber_id
    and detail.service_date between p_period_start and p_period_end
    and coalesce(detail.appointment_item_id, detail.internal_service_id) = any(v_selected_item_ids)
    and detail.payable_commission_cents > 0;
  if v_selected_count <> cardinality(v_selected_item_ids) then raise exception using errcode = '22023', message = 'selected commission is not open in the requested period'; end if;
  if exists (
    select 1 from public.commission_payout_items payout_item
    join public.commission_payouts payout on payout.organization_id = payout_item.organization_id and payout.id = payout_item.payout_id and payout.status = 'OPEN'
    join public.commission_ledger ledger on ledger.organization_id = payout_item.organization_id and ledger.id = payout_item.ledger_entry_id
    where payout_item.organization_id = p_organization_id and payout.barber_id = p_barber_id and (
      (ledger.project_internal_service_id = any(v_selected_item_ids)) or (ledger.appointment_item_id = any(v_selected_item_ids))
    )
  ) then raise exception using errcode = '22023', message = 'selected commission is already reserved for payment'; end if;
  insert into public.commission_payouts (organization_id, barber_id, period_start, period_end, amount_cents)
  values (p_organization_id, p_barber_id, p_period_start, p_period_end, 0) returning * into v_payout;
  for v_ledger in
    select ledger.* from public.commission_ledger ledger
    join public.commission_service_details detail on detail.organization_id = ledger.organization_id and (
      (ledger.project_internal_service_id is not null and detail.internal_service_id = ledger.project_internal_service_id)
      or (ledger.project_internal_service_id is null and detail.appointment_id = ledger.appointment_id and detail.appointment_item_id = ledger.appointment_item_id)
    )
    where ledger.organization_id = p_organization_id and ledger.barber_id = p_barber_id
      and coalesce(ledger.appointment_item_id, ledger.project_internal_service_id) = any(v_selected_item_ids)
      and detail.service_date between p_period_start and p_period_end
    order by coalesce(ledger.appointment_item_id, ledger.project_internal_service_id), ledger.created_at, ledger.id for update of ledger
  loop
    insert into public.commission_payout_items (organization_id, payout_id, ledger_entry_id)
    values (p_organization_id, v_payout.id, v_ledger.id);
    v_amount := v_amount + v_ledger.amount_cents;
  end loop;
  if v_amount <= 0 then raise exception using errcode = '22023', message = 'no positive unpaid commission in selection'; end if;
  update public.commission_payouts set amount_cents = v_amount where organization_id = p_organization_id and id = v_payout.id;
  insert into public.commission_payout_settlements (
    organization_id, payout_id, financial_account_id, amount_cents, paid_on, launch_on, due_on,
    document_number, tags, payment_method, reference, idempotency_key, created_by
  ) values (
    p_organization_id, v_payout.id, p_financial_account_id, v_amount, current_date, p_launch_on, p_due_on,
    nullif(btrim(p_document_number), ''), nullif(btrim(p_tags), ''), p_payment_method,
    nullif(btrim(p_reference), ''), p_idempotency_key, auth.uid()
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
revoke all on function public.pay_commission(uuid, uuid, date, date, uuid[], date, date, uuid, public.financial_payment_method, text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.pay_commission(uuid, uuid, date, date, uuid[], date, date, uuid, public.financial_payment_method, text, text, text, text) to authenticated;
