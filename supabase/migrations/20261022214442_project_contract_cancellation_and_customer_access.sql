-- Cancelamento bilateral de contratos de projetos e acesso do cliente ao plano contratado.
create table public.customer_project_cancellation_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  engagement_id uuid not null,
  customer_id uuid not null,
  status text not null check (status in ('PENDING', 'CONFIRMED')),
  reason text not null check (reason in ('FINANCIAL_DIFFICULTY', 'LACK_OF_TIME', 'ADDRESS_CHANGE', 'OTHER')),
  observations text check (observations is null or char_length(btrim(observations)) <= 2000),
  last_session_id uuid,
  last_installment_id uuid,
  requested_by uuid not null references auth.users(id),
  requested_at timestamptz not null default now(),
  confirmed_by uuid references auth.users(id),
  confirmed_at timestamptz,
  unique (id, organization_id),
  foreign key (engagement_id, organization_id) references public.project_engagements(id, organization_id) on delete cascade,
  foreign key (customer_id, organization_id) references public.customers(id, organization_id) on delete cascade,
  foreign key (last_session_id, organization_id) references public.project_engagement_sessions(id, organization_id),
  foreign key (last_installment_id, organization_id) references public.project_installments(id, organization_id),
  check ((status = 'PENDING' and confirmed_by is null and confirmed_at is null)
      or (status = 'CONFIRMED' and confirmed_by is not null and confirmed_at is not null))
);

create unique index customer_project_one_pending_cancellation
  on public.customer_project_cancellation_requests (organization_id, engagement_id) where status = 'PENDING';
create index customer_project_cancellations_customer_idx
  on public.customer_project_cancellation_requests (organization_id, customer_id, requested_at desc);
alter table public.customer_project_cancellation_requests enable row level security;
alter table public.customer_project_cancellation_requests force row level security;
create policy customer_project_cancellations_read on public.customer_project_cancellation_requests
  for select to authenticated using (public.is_organization_owner(organization_id)
    or public.is_organization_customer(organization_id, customer_id));
grant select on public.customer_project_cancellation_requests to authenticated;

create policy project_engagement_sessions_customer_select on public.project_engagement_sessions
  for select to authenticated using (exists (
    select 1 from public.project_engagements engagement
    where engagement.id = project_engagement_sessions.engagement_id
      and engagement.organization_id = project_engagement_sessions.organization_id
      and public.is_organization_customer(engagement.organization_id, engagement.customer_id)
  ));

alter table public.manager_notifications drop constraint if exists manager_notifications_kind_check;
alter table public.manager_notifications add constraint manager_notifications_kind_check
  check (kind in ('SUBSCRIPTION_REQUEST', 'SUBSCRIPTION_OFFER_DECLINED', 'PROJECT_OFFER_DECLINED',
    'SUBSCRIPTION_CANCELLATION_REQUEST', 'PROJECT_CANCELLATION_REQUEST'));

create or replace function public.get_customer_project_booking_options(p_organization_id uuid, p_session_id uuid)
returns table (service_id uuid, service_name text, barber_id uuid, barber_name text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_engagement public.project_engagements%rowtype; v_session public.project_engagement_sessions%rowtype;
begin
  select * into strict v_session from public.project_engagement_sessions
   where id = p_session_id and organization_id = p_organization_id;
  select * into strict v_engagement from public.project_engagements
   where id = v_session.engagement_id and organization_id = p_organization_id;
  if not public.is_organization_customer(p_organization_id, v_engagement.customer_id)
     or v_session.status <> 'OPEN' or v_engagement.status <> 'ACTIVE'
     or exists (select 1 from public.customer_project_cancellation_requests r
       where r.organization_id = p_organization_id and r.engagement_id = v_engagement.id and r.status = 'PENDING'
         and (r.last_session_id is null or v_session.session_number > (
           select cutoff.session_number from public.project_engagement_sessions cutoff
           where cutoff.id = r.last_session_id and cutoff.organization_id = p_organization_id))) then
    raise exception using errcode = '42501', message = 'project session booking is not available';
  end if;
  return query
    select assignment.service_id, service.name, assignment.barber_id, barber.display_name
      from public.project_package_service_assignments assignment
      join public.services service on service.id = assignment.service_id and service.organization_id = assignment.organization_id and service.active
      join public.barbers barber on barber.id = assignment.barber_id and barber.organization_id = assignment.organization_id and barber.active
     where assignment.organization_id = p_organization_id and assignment.project_package_id = v_engagement.package_id
     order by barber.display_name, service.name;
end $$;
revoke all on function public.get_customer_project_booking_options(uuid, uuid) from public, anon;
grant execute on function public.get_customer_project_booking_options(uuid, uuid) to authenticated;

create or replace function public.request_customer_project_cancellation(
  p_organization_id uuid, p_engagement_id uuid, p_last_session_id uuid,
  p_reason text, p_observations text default null
)
returns public.customer_project_cancellation_requests
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_engagement public.project_engagements%rowtype;
  v_request public.customer_project_cancellation_requests%rowtype;
  v_customer public.customers%rowtype;
  v_project public.projects%rowtype;
  v_package public.project_packages%rowtype;
  v_existing public.customer_project_cancellation_requests%rowtype;
  v_owner uuid;
  v_reason text := upper(btrim(coalesce(p_reason, '')));
  v_observations text := nullif(btrim(coalesce(p_observations, '')), '');
begin
  select * into strict v_engagement from public.project_engagements
   where id = p_engagement_id and organization_id = p_organization_id for update;
  if auth.uid() is null or not public.is_organization_customer(p_organization_id, v_engagement.customer_id)
     or v_engagement.status <> 'ACTIVE' then
    raise exception using errcode = '42501', message = 'project cancellation request denied';
  end if;
  if v_reason not in ('FINANCIAL_DIFFICULTY', 'LACK_OF_TIME', 'ADDRESS_CHANGE', 'OTHER')
     or (v_reason = 'OTHER' and v_observations is null) or char_length(coalesce(v_observations, '')) > 2000 then
    raise exception using errcode = '22023', message = 'invalid project cancellation reason or observations';
  end if;
  if p_last_session_id is not null and not exists (
    select 1 from public.project_engagement_sessions session
     where session.id = p_last_session_id and session.organization_id = p_organization_id
       and session.engagement_id = v_engagement.id and session.status in ('OPEN', 'BOOKED')
  ) then raise exception using errcode = '22023', message = 'invalid final project session'; end if;
  select * into v_existing from public.customer_project_cancellation_requests
   where organization_id = p_organization_id and engagement_id = v_engagement.id and status = 'PENDING' for update;
  if found then return v_existing; end if;
  select * into strict v_customer from public.customers where id = v_engagement.customer_id and organization_id = p_organization_id;
  select * into strict v_project from public.projects where id = v_engagement.project_id and organization_id = p_organization_id;
  select * into strict v_package from public.project_packages where id = v_engagement.package_id and organization_id = p_organization_id;
  insert into public.customer_project_cancellation_requests(
    organization_id, engagement_id, customer_id, status, reason, observations, last_session_id, requested_by
  ) values (p_organization_id, v_engagement.id, v_engagement.customer_id, 'PENDING', v_reason, v_observations, p_last_session_id, auth.uid())
  returning * into v_request;
  for v_owner in select user_id from public.organization_memberships
    where organization_id = p_organization_id and active and role = 'OWNER'
  loop
    insert into public.manager_notifications(organization_id, recipient_user_id, customer_id, engagement_id, kind, title, body, href)
    values (p_organization_id, v_owner, v_engagement.customer_id, v_engagement.id, 'PROJECT_CANCELLATION_REQUEST',
      'Solicitação de cancelamento de projeto',
      v_customer.full_name || ' solicitou cancelar ' || v_project.name || ' · ' || v_package.name || '.',
      '/gestor/projetos/' || v_engagement.project_id::text || '?contrato=' || v_engagement.id::text)
    on conflict do nothing;
  end loop;
  return v_request;
exception when no_data_found then
  raise exception using errcode = 'P0002', message = 'project contract not found';
end $$;
revoke all on function public.request_customer_project_cancellation(uuid, uuid, uuid, text, text) from public, anon;
grant execute on function public.request_customer_project_cancellation(uuid, uuid, uuid, text, text) to authenticated;

create or replace function public.confirm_customer_project_cancellation(
  p_organization_id uuid, p_engagement_id uuid, p_last_installment_id uuid,
  p_last_session_id uuid, p_reason text, p_observations text default null, p_request_id uuid default null
)
returns public.project_engagements
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_engagement public.project_engagements%rowtype;
  v_request public.customer_project_cancellation_requests%rowtype;
  v_cutoff_installment integer;
  v_cutoff_session integer;
  v_installment public.project_installments%rowtype;
  v_session public.project_engagement_sessions%rowtype;
  v_today date;
  v_timezone text;
  v_item record;
  v_reason text := upper(btrim(coalesce(p_reason, '')));
  v_observations text := nullif(btrim(coalesce(p_observations, '')), '');
begin
  if auth.uid() is null or not public.is_organization_owner(p_organization_id)
     or not public.organization_allows_management_mutations(p_organization_id) then
    raise exception using errcode = '42501', message = 'project cancellation confirmation denied';
  end if;
  select * into strict v_engagement from public.project_engagements
   where id = p_engagement_id and organization_id = p_organization_id for update;
  if p_request_id is null and v_engagement.status <> 'ACTIVE' then raise exception using errcode = '22023', message = 'project contract cannot be canceled'; end if;
  select timezone into v_timezone from public.organizations where id = p_organization_id;
  v_today := (now() at time zone coalesce(v_timezone, 'America/Sao_Paulo'))::date;
  if p_request_id is not null then
    select * into strict v_request from public.customer_project_cancellation_requests
     where id = p_request_id and engagement_id = v_engagement.id and organization_id = p_organization_id for update;
    if v_request.status = 'CONFIRMED' then return v_engagement; end if;
    if v_request.status <> 'PENDING' then raise exception using errcode = '22023', message = 'project cancellation request is not pending'; end if;
    if v_engagement.status <> 'ACTIVE' then raise exception using errcode = '22023', message = 'project contract cannot be canceled'; end if;
    p_last_session_id := v_request.last_session_id;
    v_reason := v_request.reason;
    v_observations := v_request.observations;
  else
    if v_reason not in ('FINANCIAL_DIFFICULTY', 'LACK_OF_TIME', 'ADDRESS_CHANGE', 'OTHER')
       or (v_reason = 'OTHER' and v_observations is null) or char_length(coalesce(v_observations, '')) > 2000 then
      raise exception using errcode = '22023', message = 'invalid project cancellation reason or observations';
    end if;
    insert into public.customer_project_cancellation_requests(
      organization_id, engagement_id, customer_id, status, reason, observations, last_session_id,
      requested_by, confirmed_by, confirmed_at
    ) values (p_organization_id, v_engagement.id, v_engagement.customer_id, 'CONFIRMED', v_reason,
      v_observations, p_last_session_id, auth.uid(), auth.uid(), now()) returning * into v_request;
  end if;
  if p_last_installment_id is not null then
    select * into strict v_installment from public.project_installments
     where id = p_last_installment_id and engagement_id = v_engagement.id and organization_id = p_organization_id
       and status in ('OPEN', 'PAID') for update;
    v_cutoff_installment := v_installment.installment_number;
  end if;
  if p_last_session_id is not null then
    select * into strict v_session from public.project_engagement_sessions
     where id = p_last_session_id and engagement_id = v_engagement.id and organization_id = p_organization_id
       and status in ('OPEN', 'BOOKED', 'COMPLETED', 'CANCELED') for update;
    v_cutoff_session := v_session.session_number;
  end if;

  -- Cancel only future, wholly-unpaid charges beyond the selected cutoff. Past-due
  -- and partially settled entries remain open so their outstanding debt is preserved.
  for v_item in
    select entry.id as financial_entry_id
      from public.project_installments installment
      join public.financial_entries entry on entry.project_installment_id = installment.id
        and entry.organization_id = installment.organization_id and entry.source = 'PROJECT'
     where installment.engagement_id = v_engagement.id and installment.organization_id = p_organization_id
       and installment.status = 'OPEN' and installment.due_on > v_today
       and (v_cutoff_installment is null or installment.installment_number > v_cutoff_installment)
       and entry.canceled_at is null
       and not exists (select 1 from public.financial_settlements settlement where settlement.organization_id = p_organization_id and settlement.entry_id = entry.id)
     for update of installment, entry
  loop
    perform public.cancel_financial_entry(v_item.financial_entry_id, 'Cancelamento do contrato de projeto');
  end loop;
  update public.project_installments installment set status = 'CANCELED'
   where installment.engagement_id = v_engagement.id and installment.organization_id = p_organization_id
     and installment.status = 'OPEN' and installment.due_on > v_today
     and (v_cutoff_installment is null or installment.installment_number > v_cutoff_installment)
     and not exists (select 1 from public.financial_entries entry join public.financial_settlements settlement
       on settlement.organization_id = entry.organization_id and settlement.entry_id = entry.id
       where entry.organization_id = installment.organization_id and entry.project_installment_id = installment.id);

  for v_item in
    select session.id, session.status, session.appointment_id, appointment.status as appointment_status
      from public.project_engagement_sessions session
      left join public.appointments appointment on appointment.id = session.appointment_id and appointment.organization_id = session.organization_id
     where session.engagement_id = v_engagement.id and session.organization_id = p_organization_id
       and session.status in ('OPEN', 'BOOKED')
       and (v_cutoff_session is null or session.session_number > v_cutoff_session)
     order by session.session_number for update of session
  loop
    if v_item.status = 'BOOKED' and v_item.appointment_id is not null
       and v_item.appointment_status in ('HELD', 'PENDING_PAYMENT', 'CONFIRMED') then
      perform public.cancel_appointment(v_item.appointment_id, 'Cancelamento de projeto confirmado pelo gestor', false);
    end if;
    update public.project_engagement_sessions set status = 'CANCELED', appointment_id = null, updated_at = now()
     where id = v_item.id and organization_id = p_organization_id;
  end loop;
  update public.project_engagements set status = 'CANCELED', updated_at = now()
   where id = v_engagement.id and organization_id = p_organization_id returning * into v_engagement;
  update public.customer_project_cancellation_requests set status = 'CONFIRMED', last_installment_id = p_last_installment_id,
    confirmed_by = auth.uid(), confirmed_at = coalesce(confirmed_at, now())
   where id = v_request.id and organization_id = p_organization_id;
  update public.manager_notifications set read_at = coalesce(read_at, now())
   where organization_id = p_organization_id and engagement_id = v_engagement.id and kind = 'PROJECT_CANCELLATION_REQUEST';
  return v_engagement;
exception when no_data_found then
  raise exception using errcode = 'P0002', message = 'project contract, request or cutoff not found';
end $$;
revoke all on function public.confirm_customer_project_cancellation(uuid, uuid, uuid, uuid, text, text, uuid) from public, anon;
grant execute on function public.confirm_customer_project_cancellation(uuid, uuid, uuid, uuid, text, text, uuid) to authenticated;

-- Project session availability and booking are shared with the customer app;
-- organization, engagement, customer, package assignments, and session state are checked in every RPC.
create or replace function public.get_project_session_environments(
  p_organization_id uuid, p_session_id uuid, p_barber_id uuid, p_service_id uuid, p_starts_at timestamptz
)
returns table (id uuid, name text, sort_order integer)
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  v_org public.organizations%rowtype; v_session public.project_engagement_sessions%rowtype;
  v_engagement public.project_engagements%rowtype; v_package public.project_packages%rowtype;
  v_service public.services%rowtype; v_barber public.barbers%rowtype;
  v_period tstzrange; v_local_start timestamp; v_local_end timestamp; v_occupied integer;
begin
  select * into strict v_org from public.organizations where id = p_organization_id;
  select * into strict v_session from public.project_engagement_sessions where id = p_session_id and organization_id = p_organization_id;
  select * into strict v_engagement from public.project_engagements where id = v_session.engagement_id and organization_id = p_organization_id;
  if not public.is_organization_owner(p_organization_id) and not public.is_organization_customer(p_organization_id, v_engagement.customer_id) then
    raise exception using errcode = '42501', message = 'project session availability denied';
  end if;
  if v_session.status <> 'OPEN' then return; end if;
  if v_engagement.status <> 'ACTIVE' and not exists (select 1 from public.customer_project_cancellation_requests r
    where r.organization_id = p_organization_id and r.engagement_id = v_engagement.id and r.status = 'CONFIRMED' and r.last_session_id = v_session.id) then return; end if;
  if exists (select 1 from public.customer_project_cancellation_requests r where r.organization_id = p_organization_id
    and r.engagement_id = v_engagement.id and r.status = 'PENDING' and (r.last_session_id is null or v_session.session_number >
      (select cutoff.session_number from public.project_engagement_sessions cutoff where cutoff.id = r.last_session_id and cutoff.organization_id = p_organization_id))) then return; end if;
  select * into strict v_package from public.project_packages where id = v_engagement.package_id and organization_id = p_organization_id;
  perform 1 from public.project_package_service_assignments where organization_id = p_organization_id
    and project_package_id = v_package.id and service_id = p_service_id and barber_id = p_barber_id;
  if not found then return; end if;
  select * into strict v_service from public.services where id = p_service_id and organization_id = p_organization_id and active;
  select * into strict v_barber from public.barbers where id = p_barber_id and organization_id = p_organization_id and active;
  if p_starts_at <= now() then return; end if;
  v_local_start := p_starts_at at time zone v_org.timezone;
  if extract(second from v_local_start) <> 0 or mod(extract(minute from v_local_start)::integer, v_org.slot_interval_minutes) <> 0 then return; end if;
  v_occupied := ceil(v_service.duration_minutes::numeric / v_org.slot_interval_minutes)::integer * v_org.slot_interval_minutes;
  v_period := tstzrange(p_starts_at, p_starts_at + make_interval(mins => v_occupied), '[)');
  v_local_end := upper(v_period) at time zone v_org.timezone;
  if v_local_start::date <> v_local_end::date or exists (select 1 from public.availability_exceptions ae where ae.organization_id = p_organization_id
    and ae.barber_id = p_barber_id and ae.kind = 'UNAVAILABLE' and ae.service_period && v_period) then return; end if;
  return query select environment.id, environment.name, environment.sort_order from public.agenda_environments environment
   where environment.organization_id = p_organization_id and environment.location_id = v_barber.location_id and environment.active
     and (exists (select 1 from public.availability_exceptions ae where ae.organization_id = p_organization_id and ae.barber_id = p_barber_id
       and ae.kind = 'AVAILABLE_OVERRIDE' and ae.environment_id = environment.id and ae.service_period @> v_period)
       or exists (select 1 from public.work_intervals wi where wi.organization_id = p_organization_id and wi.barber_id = p_barber_id
       and wi.environment_id = environment.id and wi.active and wi.weekday = extract(dow from v_local_start)::smallint
       and wi.starts_at <= v_local_start::time and wi.ends_at >= v_local_end::time))
     and not exists (select 1 from public.appointments a where a.organization_id = p_organization_id and a.environment_id = environment.id
       and a.status in ('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'IN_SERVICE') and a.service_period && v_period)
     and not exists (select 1 from public.appointments a where a.organization_id = p_organization_id and a.barber_id = p_barber_id
       and a.status in ('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'IN_SERVICE') and a.service_period && v_period)
     and not exists (select 1 from public.walkin_queue_holds h where h.organization_id = p_organization_id and h.barber_id = p_barber_id
       and h.consumed_at is null and h.expires_at > now() and h.service_period && v_period)
   order by environment.sort_order, environment.id;
exception when no_data_found then return;
end $$;
revoke all on function public.get_project_session_environments(uuid, uuid, uuid, uuid, timestamptz) from public, anon;
grant execute on function public.get_project_session_environments(uuid, uuid, uuid, uuid, timestamptz) to authenticated;

create or replace function public.create_project_appointment(
  p_organization_id uuid, p_session_id uuid, p_barber_id uuid, p_service_id uuid,
  p_starts_at timestamptz, p_environment_id uuid, p_override_reason text default null, p_notes text default null
)
returns uuid language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_org public.organizations%rowtype; v_session public.project_engagement_sessions%rowtype;
  v_engagement public.project_engagements%rowtype; v_package public.project_packages%rowtype;
  v_service public.services%rowtype; v_barber public.barbers%rowtype; v_assignment public.project_package_service_assignments%rowtype;
  v_customer_id uuid; v_period tstzrange; v_occupied integer; v_appointment_id uuid; v_local_start timestamp;
  v_owner boolean; v_allowed_canceled_final boolean := false;
begin
  v_owner := public.is_organization_owner(p_organization_id);
  select * into strict v_session from public.project_engagement_sessions where id = p_session_id and organization_id = p_organization_id for update;
  select * into strict v_engagement from public.project_engagements where id = v_session.engagement_id and organization_id = p_organization_id for update;
  if not v_owner and not public.is_organization_customer(p_organization_id, v_engagement.customer_id) then
    raise exception using errcode = '42501', message = 'project session booking denied';
  end if;
  if v_session.status <> 'OPEN' or v_session.appointment_id is not null then raise exception using errcode = '40001', message = 'project session is not available'; end if;
  if v_engagement.status = 'CANCELED' then
    select exists (select 1 from public.customer_project_cancellation_requests r where r.organization_id = p_organization_id
      and r.engagement_id = v_engagement.id and r.status = 'CONFIRMED' and r.last_session_id = v_session.id) into v_allowed_canceled_final;
  end if;
  if v_engagement.status <> 'ACTIVE' and not v_allowed_canceled_final then raise exception using errcode = '22023', message = 'project contract is not active'; end if;
  if not v_owner and exists (select 1 from public.customer_project_cancellation_requests r where r.organization_id = p_organization_id
    and r.engagement_id = v_engagement.id and r.status = 'PENDING' and (r.last_session_id is null or v_session.session_number >
      (select cutoff.session_number from public.project_engagement_sessions cutoff where cutoff.id = r.last_session_id and cutoff.organization_id = p_organization_id))) then
    raise exception using errcode = '22023', message = 'project session exceeds cancellation request cutoff'; end if;
  select * into strict v_package from public.project_packages where id = v_engagement.package_id and organization_id = p_organization_id;
  select * into strict v_assignment from public.project_package_service_assignments where organization_id = p_organization_id
    and project_package_id = v_package.id and service_id = p_service_id and barber_id = p_barber_id;
  select * into strict v_service from public.services where id = p_service_id and organization_id = p_organization_id and active;
  select * into strict v_barber from public.barbers where id = p_barber_id and organization_id = p_organization_id and active;
  select * into strict v_org from public.organizations where id = p_organization_id;
  if p_starts_at <= now() then raise exception using errcode = '22023', message = 'appointment start must be in the future'; end if;
  v_local_start := p_starts_at at time zone v_org.timezone;
  if extract(second from v_local_start) <> 0 or mod(extract(minute from v_local_start)::integer, v_org.slot_interval_minutes) <> 0 then raise exception using errcode = '22023', message = 'start time is not aligned to slot interval'; end if;
  v_occupied := ceil(v_service.duration_minutes::numeric / v_org.slot_interval_minutes)::integer * v_org.slot_interval_minutes;
  v_period := tstzrange(p_starts_at, p_starts_at + make_interval(mins => v_occupied), '[)');
  perform set_config('app.agenda_environment_id', coalesce(p_environment_id::text, ''), true);
  if not public.is_barber_available(p_organization_id, p_barber_id, v_period)
     and (not v_owner or nullif(btrim(p_override_reason), '') is null) then
    raise exception using errcode = '22023', message = 'professional is not available';
  end if;
  if not exists (select 1 from public.get_project_session_environments(p_organization_id, p_session_id, p_barber_id, p_service_id, p_starts_at) env where env.id = p_environment_id) then
    raise exception using errcode = '23P01', message = 'requested environment is no longer available'; end if;
  v_customer_id := v_engagement.customer_id;
  insert into public.appointments (organization_id, location_id, customer_id, barber_id, status, source, service_period, payment_mode, currency,
    total_cents_snapshot, list_total_cents_snapshot, deposit_bps_snapshot, deposit_required_cents_snapshot, cancellation_lead_minutes_snapshot,
    schedule_override_reason, notes, environment_id, created_by)
  values (p_organization_id, v_barber.location_id, v_customer_id, p_barber_id, 'CONFIRMED', 'PROJECT', v_period, 'COUNTER', v_org.currency, 0, 0,
    v_org.deposit_bps, 0, v_org.cancellation_lead_minutes, nullif(btrim(p_override_reason), ''), p_notes, p_environment_id, auth.uid())
  returning id into v_appointment_id;
  insert into public.appointment_items (organization_id, appointment_id, selection_key, source, service_id, service_name_snapshot, quantity,
    charged_price_cents_snapshot, list_price_cents_snapshot, duration_minutes_snapshot, commission_mode_snapshot, commission_fixed_cents_snapshot, position)
  values (p_organization_id, v_appointment_id, p_service_id, 'SERVICE', p_service_id, v_service.name, 1, 0, v_service.price_cents,
    v_service.duration_minutes, 'FIXED', v_assignment.commission_cents, 0);
  update public.project_engagement_sessions set appointment_id = v_appointment_id, service_id = p_service_id, barber_id = p_barber_id, status = 'BOOKED', updated_at = now()
   where id = p_session_id and organization_id = p_organization_id;
  insert into public.appointment_status_events (organization_id, appointment_id, to_status, reason, actor_user_id, metadata)
  values (p_organization_id, v_appointment_id, 'CONFIRMED', 'project_session_booking', auth.uid(), jsonb_build_object('project_session_id', p_session_id, 'project_engagement_id', v_engagement.id));
  return v_appointment_id;
exception when exclusion_violation then raise exception using errcode = '23P01', message = 'requested slot is no longer available';
  when no_data_found then raise exception using errcode = 'P0002', message = 'project session, service or professional not found';
end $$;
revoke all on function public.create_project_appointment(uuid, uuid, uuid, uuid, timestamptz, uuid, text, text) from public, anon;
grant execute on function public.create_project_appointment(uuid, uuid, uuid, uuid, timestamptz, uuid, text, text) to authenticated;
