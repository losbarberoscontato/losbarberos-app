-- Separates a customer's cancellation request from the manager's final approval.
create table public.customer_subscription_cancellation_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid not null,
  customer_id uuid not null,
  status text not null check (status in ('PENDING', 'CONFIRMED')),
  reason text not null check (reason in ('FINANCIAL_DIFFICULTY', 'LACK_OF_TIME', 'ADDRESS_CHANGE', 'OTHER')),
  observations text check (observations is null or char_length(btrim(observations)) <= 2000),
  last_session_id uuid,
  last_cycle_id uuid,
  requested_by uuid not null references auth.users(id),
  requested_at timestamptz not null default now(),
  confirmed_by uuid references auth.users(id),
  confirmed_at timestamptz,
  unique (id, organization_id),
  foreign key (subscription_id, organization_id)
    references public.customer_subscriptions(id, organization_id) on delete cascade,
  foreign key (customer_id, organization_id)
    references public.customers(id, organization_id) on delete cascade,
  foreign key (last_session_id, organization_id)
    references public.customer_subscription_sessions(id, organization_id),
  foreign key (last_cycle_id, organization_id)
    references public.customer_subscription_cycles(id, organization_id),
  check ((status = 'PENDING' and confirmed_by is null and confirmed_at is null)
      or (status = 'CONFIRMED' and confirmed_by is not null and confirmed_at is not null))
);

create unique index customer_subscription_one_pending_cancellation
  on public.customer_subscription_cancellation_requests (organization_id, subscription_id)
  where status = 'PENDING';
create index customer_subscription_cancellations_customer_idx
  on public.customer_subscription_cancellation_requests (organization_id, customer_id, requested_at desc);

alter table public.customer_subscription_cancellation_requests enable row level security;
alter table public.customer_subscription_cancellation_requests force row level security;
create policy customer_subscription_cancellations_read
  on public.customer_subscription_cancellation_requests for select to authenticated
  using (public.is_organization_owner(organization_id)
      or public.is_organization_customer(organization_id, customer_id));
grant select on public.customer_subscription_cancellation_requests to authenticated;

alter table public.manager_notifications
  drop constraint if exists manager_notifications_kind_check;
alter table public.manager_notifications
  add constraint manager_notifications_kind_check
  check (kind in (
    'SUBSCRIPTION_REQUEST', 'SUBSCRIPTION_OFFER_DECLINED', 'PROJECT_OFFER_DECLINED',
    'SUBSCRIPTION_CANCELLATION_REQUEST'
  ));

create or replace function public.request_customer_subscription_cancellation(
  p_organization_id uuid,
  p_subscription_id uuid,
  p_last_session_id uuid,
  p_reason text,
  p_observations text default null
)
returns public.customer_subscription_cancellation_requests
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_sub public.customer_subscriptions%rowtype;
  v_customer public.customers%rowtype;
  v_request public.customer_subscription_cancellation_requests%rowtype;
  v_plan_name text;
  v_owner uuid;
  v_reason text := upper(btrim(coalesce(p_reason, '')));
  v_observations text := nullif(btrim(coalesce(p_observations, '')), '');
begin
  if auth.uid() is null or not public.is_organization_customer(p_organization_id, (
    select customer_id from public.customer_subscriptions
     where id = p_subscription_id and organization_id = p_organization_id
  )) then
    raise exception using errcode = '42501', message = 'subscription cancellation request denied';
  end if;
  if v_reason not in ('FINANCIAL_DIFFICULTY', 'LACK_OF_TIME', 'ADDRESS_CHANGE', 'OTHER') then
    raise exception using errcode = '22023', message = 'invalid cancellation reason';
  end if;
  if v_reason = 'OTHER' and v_observations is null then
    raise exception using errcode = '22023', message = 'cancellation observations required';
  end if;
  if char_length(coalesce(v_observations, '')) > 2000 then
    raise exception using errcode = '22023', message = 'cancellation observations too long';
  end if;

  select * into strict v_sub
    from public.customer_subscriptions
   where id = p_subscription_id and organization_id = p_organization_id
   for update;
  if v_sub.status not in ('ACTIVE', 'PENDING_PAYMENT') then
    raise exception using errcode = '22023', message = 'subscription cannot request cancellation';
  end if;
  if p_last_session_id is not null and not exists (
    select 1 from public.customer_subscription_sessions session
     where session.id = p_last_session_id
       and session.organization_id = p_organization_id
       and session.subscription_id = v_sub.id
       and session.status in ('AVAILABLE', 'SCHEDULED')
  ) then
    raise exception using errcode = '22023', message = 'invalid final subscription session';
  end if;

  select * into strict v_customer from public.customers
   where id = v_sub.customer_id and organization_id = p_organization_id;
  select name into v_plan_name from public.subscription_plans
   where id = v_sub.plan_id and organization_id = p_organization_id;

  insert into public.customer_subscription_cancellation_requests (
    organization_id, subscription_id, customer_id, status, reason, observations,
    last_session_id, requested_by
  ) values (
    p_organization_id, v_sub.id, v_sub.customer_id, 'PENDING', v_reason,
    v_observations, p_last_session_id, auth.uid()
  ) returning * into v_request;

  update public.customer_subscriptions
     set cancellation_requested_at = v_request.requested_at,
         cancellation_reason = v_reason || case when v_observations is null then '' else ': ' || v_observations end,
         updated_at = now()
   where id = v_sub.id and organization_id = p_organization_id;

  for v_owner in
    select membership.user_id from public.organization_memberships membership
     where membership.organization_id = p_organization_id
       and membership.active and membership.role = 'OWNER'
  loop
    insert into public.manager_notifications (
      organization_id, recipient_user_id, customer_id, subscription_id, kind, title, body, href
    ) values (
      p_organization_id, v_owner, v_sub.customer_id, v_sub.id,
      'SUBSCRIPTION_CANCELLATION_REQUEST', 'Solicitação de cancelamento de assinatura',
      v_customer.full_name || ' solicitou cancelar ' || coalesce(v_plan_name, 'uma assinatura') || '.',
      '/gestor/clientes?cliente=' || v_sub.customer_id::text || '&assinatura=' || v_sub.id::text || '&aba=assinaturas'
    ) on conflict do nothing;
  end loop;

  return v_request;
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'subscription not found';
end $$;

revoke all on function public.request_customer_subscription_cancellation(uuid,uuid,uuid,text,text) from public, anon;
grant execute on function public.request_customer_subscription_cancellation(uuid,uuid,uuid,text,text) to authenticated;

create or replace function public.confirm_customer_subscription_cancellation(
  p_organization_id uuid,
  p_subscription_id uuid,
  p_last_cycle_id uuid,
  p_last_session_id uuid,
  p_reason text,
  p_observations text default null,
  p_request_id uuid default null
)
returns public.customer_subscriptions
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_sub public.customer_subscriptions%rowtype;
  v_request public.customer_subscription_cancellation_requests%rowtype;
  v_session public.customer_subscription_sessions%rowtype;
  v_cutoff_cycle smallint;
  v_effective_date date;
  v_reason text := upper(btrim(coalesce(p_reason, '')));
  v_observations text := nullif(btrim(coalesce(p_observations, '')), '');
  v_session_to_cancel record;
  v_timezone text;
  v_today date;
begin
  if auth.uid() is null or not public.is_organization_owner(p_organization_id)
     or not public.organization_allows_management_mutations(p_organization_id) then
    raise exception using errcode = '42501', message = 'subscription cancellation confirmation denied';
  end if;
  select * into strict v_sub from public.customer_subscriptions
   where id = p_subscription_id and organization_id = p_organization_id for update;
  select timezone into v_timezone from public.organizations where id = p_organization_id;
  v_today := (now() at time zone coalesce(v_timezone, 'America/Sao_Paulo'))::date;

  if p_request_id is not null then
    select * into strict v_request from public.customer_subscription_cancellation_requests
     where id = p_request_id and subscription_id = v_sub.id and organization_id = p_organization_id
     for update;
    if v_request.status = 'CONFIRMED' then return v_sub; end if;
    if v_request.status <> 'PENDING' then
      raise exception using errcode = '22023', message = 'cancellation request is not pending';
    end if;
    p_last_session_id := v_request.last_session_id;
    v_reason := v_request.reason;
    v_observations := v_request.observations;
  else
    if v_sub.status not in ('ACTIVE', 'PENDING_PAYMENT') then
      raise exception using errcode = '22023', message = 'subscription cannot be canceled';
    end if;
    if v_reason not in ('FINANCIAL_DIFFICULTY', 'LACK_OF_TIME', 'ADDRESS_CHANGE', 'OTHER') then
      raise exception using errcode = '22023', message = 'invalid cancellation reason';
    end if;
    if v_reason = 'OTHER' and v_observations is null then
      raise exception using errcode = '22023', message = 'cancellation observations required';
    end if;
    if char_length(coalesce(v_observations, '')) > 2000 then
      raise exception using errcode = '22023', message = 'cancellation observations too long';
    end if;
    insert into public.customer_subscription_cancellation_requests (
      organization_id, subscription_id, customer_id, status, reason, observations,
      last_session_id, requested_by, confirmed_by, confirmed_at
    ) values (
      p_organization_id, v_sub.id, v_sub.customer_id, 'CONFIRMED', v_reason,
      v_observations, p_last_session_id, auth.uid(), auth.uid(), now()
    ) returning * into v_request;
  end if;

  if p_last_cycle_id is not null then
    select cycle_number into strict v_cutoff_cycle from public.customer_subscription_cycles
     where id = p_last_cycle_id and subscription_id = v_sub.id
       and organization_id = p_organization_id and status in ('OPEN', 'OVERDUE', 'PAID');
  else
    v_cutoff_cycle := null;
  end if;
  if p_last_session_id is not null then
    select session.* into strict v_session
      from public.customer_subscription_sessions session
     where session.id = p_last_session_id and session.subscription_id = v_sub.id
       and session.organization_id = p_organization_id
       and session.status in ('AVAILABLE', 'SCHEDULED', 'COMPLETED', 'CONSUMED', 'CANCELED');
  end if;

  -- Keep all already-due amounts. Cancel only future installments after the selected cutoff.
  update public.customer_subscription_cycles cycle
     set status = 'CANCELED', canceled_at = now()
   where cycle.subscription_id = v_sub.id and cycle.organization_id = p_organization_id
     and cycle.status in ('OPEN', 'OVERDUE')
     and cycle.due_on > v_today
     and (v_cutoff_cycle is null or cycle.cycle_number > v_cutoff_cycle);

  -- Stop unused sessions after the selected final session. Cancel booked appointments
  -- through the normal appointment RPC so its ledger, reminders, and status events stay intact.
  for v_session_to_cancel in
    select session.id, session.status, session.appointment_id, appointment.status as appointment_status,
           cycle.cycle_number, session.session_number
      from public.customer_subscription_sessions session
      join public.customer_subscription_cycles cycle
        on cycle.id = session.cycle_id and cycle.organization_id = session.organization_id
      left join public.appointments appointment
        on appointment.id = session.appointment_id and appointment.organization_id = session.organization_id
     where session.subscription_id = v_sub.id and session.organization_id = p_organization_id
       and session.status in ('AVAILABLE', 'SCHEDULED')
       and (v_session.id is null or (cycle.cycle_number, session.session_number) > (
         select cutoff_cycle.cycle_number, cutoff_session.session_number
           from public.customer_subscription_sessions cutoff_session
           join public.customer_subscription_cycles cutoff_cycle
             on cutoff_cycle.id = cutoff_session.cycle_id and cutoff_cycle.organization_id = cutoff_session.organization_id
          where cutoff_session.id = v_session.id and cutoff_session.organization_id = p_organization_id
       ))
     order by cycle.cycle_number, session.session_number
     for update of session
  loop
    if v_session_to_cancel.status = 'SCHEDULED' then
      if v_session_to_cancel.appointment_id is null then
        raise exception using errcode = '22023', message = 'scheduled subscription session is missing its appointment';
      elsif v_session_to_cancel.appointment_status in ('HELD', 'PENDING_PAYMENT', 'CONFIRMED') then
        perform public.cancel_appointment(v_session_to_cancel.appointment_id, 'Cancelamento de assinatura confirmado pelo gestor', false);
      elsif v_session_to_cancel.appointment_status not in ('CANCELED', 'NO_SHOW', 'EXPIRED') then
        raise exception using errcode = '22023', message = 'a future subscription session cannot be canceled in its current appointment state';
      end if;
    end if;
    update public.customer_subscription_sessions
       set status = 'CANCELED', appointment_id = null,
           canceled_at = coalesce(canceled_at, now())
     where id = v_session_to_cancel.id and organization_id = p_organization_id;
  end loop;

  select max(ends_on) into v_effective_date from public.customer_subscription_cycles
   where subscription_id = v_sub.id and organization_id = p_organization_id and status <> 'CANCELED';
  update public.customer_subscriptions
     set status = 'CANCELED',
         cancellation_requested_at = coalesce(cancellation_requested_at, now()),
         cancellation_effective_date = coalesce(v_effective_date, v_today),
         cancellation_reason = left(v_reason || case when v_observations is null then '' else ': ' || v_observations end, 500),
         updated_at = now()
   where id = v_sub.id and organization_id = p_organization_id returning * into v_sub;

  update public.customer_subscription_cancellation_requests
     set status = 'CONFIRMED', last_cycle_id = p_last_cycle_id,
         confirmed_by = auth.uid(), confirmed_at = coalesce(confirmed_at, now())
   where id = v_request.id and organization_id = p_organization_id;
  insert into public.subscription_events (
    organization_id, subscription_id, event_type, actor_user_id, idempotency_key, metadata
  ) values (
    p_organization_id, v_sub.id, 'CANCELED', auth.uid(),
    'cancellation-confirmed:' || v_request.id::text,
    jsonb_build_object(
      'request_id', v_request.id, 'reason', v_reason, 'observations', v_observations,
      'last_cycle_id', p_last_cycle_id, 'last_session_id', p_last_session_id,
      'effective_date', v_sub.cancellation_effective_date
    )
  ) on conflict (organization_id, idempotency_key) do nothing;
  update public.manager_notifications set read_at = coalesce(read_at, now())
   where organization_id = p_organization_id and subscription_id = v_sub.id
     and kind = 'SUBSCRIPTION_CANCELLATION_REQUEST';
  return v_sub;
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'subscription, cancellation request or cutoff was not found';
end $$;

revoke all on function public.confirm_customer_subscription_cancellation(uuid,uuid,uuid,uuid,text,text,uuid) from public, anon;
grant execute on function public.confirm_customer_subscription_cancellation(uuid,uuid,uuid,uuid,text,text,uuid) to authenticated;

-- The former client RPC canceled immediately. Remove its public API grant so all
-- client cancellations must pass through the request/manager-approval flow above.
revoke all on function public.cancel_customer_subscription(uuid,uuid,text) from public, anon, authenticated;

-- Preserve access to the selected final session after cancellation confirmation,
-- and enforce the customer/manager-selected cutoff even while request is pending.
create or replace function public.book_customer_subscription_session_before_catalog_commissions(
  p_organization_id uuid,
  p_customer_id uuid,
  p_subscription_session_id uuid,
  p_barber_id uuid,
  p_starts_at timestamptz
)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_session public.customer_subscription_sessions%rowtype;
  v_sub public.customer_subscriptions%rowtype;
  v_plan public.subscription_plan_versions%rowtype;
  v_result jsonb;
  v_items jsonb;
  v_appointment_id uuid;
  v_is_owner boolean;
  v_within_cancellation_cutoff boolean := true;
begin
  v_is_owner := public.is_organization_owner(p_organization_id);
  if not v_is_owner and not public.is_organization_customer(p_organization_id, p_customer_id) then
    raise exception using errcode = '42501', message = 'customer booking denied';
  end if;
  select * into strict v_session from public.customer_subscription_sessions
   where id = p_subscription_session_id and organization_id = p_organization_id for update;
  select * into strict v_sub from public.customer_subscriptions
   where id = v_session.subscription_id and organization_id = p_organization_id for update;
  select * into strict v_plan from public.subscription_plan_versions
   where id = v_sub.plan_version_id and organization_id = p_organization_id;

  if v_sub.status = 'CANCELED' or exists (
    select 1 from public.customer_subscription_cancellation_requests request
     where request.subscription_id = v_sub.id and request.organization_id = p_organization_id
       and request.status = 'PENDING'
  ) then
    select exists (
      select 1 from public.customer_subscription_cancellation_requests request
      join public.customer_subscription_sessions cutoff_session
        on cutoff_session.id = request.last_session_id and cutoff_session.organization_id = request.organization_id
      join public.customer_subscription_cycles cutoff_cycle
        on cutoff_cycle.id = cutoff_session.cycle_id and cutoff_cycle.organization_id = cutoff_session.organization_id
      join public.customer_subscription_cycles current_cycle
        on current_cycle.organization_id = v_session.organization_id
       and current_cycle.subscription_id = v_session.subscription_id
       and current_cycle.id = v_session.cycle_id
      where request.subscription_id = v_sub.id and request.organization_id = p_organization_id
        and request.status in ('PENDING', 'CONFIRMED')
        and (current_cycle.cycle_number, v_session.session_number) <= (cutoff_cycle.cycle_number, cutoff_session.session_number)
    ) into v_within_cancellation_cutoff;
    if v_within_cancellation_cutoff is null then v_within_cancellation_cutoff := false; end if;
  end if;

  if v_sub.customer_id <> p_customer_id
     or v_sub.status not in ('ACTIVE', 'CANCELED')
     or (v_sub.status = 'CANCELED' and not v_within_cancellation_cutoff)
     or v_session.status <> 'AVAILABLE'
     or not v_within_cancellation_cutoff then
    raise exception using errcode = '22023', message = 'subscription session is not available';
  end if;
  if p_starts_at <= now() or p_starts_at > now() + interval '15 days' then
    raise exception using errcode = '22023', message = 'subscription booking outside allowed window';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('type', 'SERVICE', 'service_id', service_id, 'quantity', 1) order by position), '[]'::jsonb)
    into v_items from public.subscription_plan_services
   where organization_id = p_organization_id and plan_version_id = v_plan.id;
  if v_is_owner then
    v_appointment_id := public.create_manual_appointment(p_organization_id, p_customer_id, p_barber_id, p_starts_at, v_items, null, null);
    select jsonb_build_object('appointment_id', id, 'status', status::text, 'service_period', service_period)
      into v_result from public.appointments where id = v_appointment_id and organization_id = p_organization_id;
  else
    v_result := public.create_appointment_hold(p_organization_id, p_customer_id, p_barber_id, p_starts_at, v_items, 'COUNTER', null);
    v_appointment_id := (v_result ->> 'appointment_id')::uuid;
  end if;
  update public.appointments set payment_mode = 'SUBSCRIPTION', total_cents_snapshot = 0,
         list_total_cents_snapshot = 0, deposit_required_cents_snapshot = 0,
         amount_waived_cents = 0, hold_expires_at = null,
         notes = concat_ws(E'\n', notes, 'Sessão assinatura')
   where id = v_appointment_id and organization_id = p_organization_id;
  update public.customer_subscription_sessions set status = 'SCHEDULED', appointment_id = v_appointment_id
   where id = v_session.id and organization_id = p_organization_id and status = 'AVAILABLE';
  if not found then raise exception using errcode = '40001', message = 'subscription session changed while booking'; end if;
  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object('appointment_id', v_appointment_id, 'status', 'CONFIRMED', 'subscription_session_id', v_session.id, 'session_label', 'Sessão assinatura');
exception when exclusion_violation then
  raise exception using errcode = '23P01', message = 'requested slot is no longer available';
when no_data_found then
  raise exception using errcode = 'P0002', message = 'organization, subscription or barber not found';
end $$;

revoke all on function public.book_customer_subscription_session_before_catalog_commissions(uuid,uuid,uuid,uuid,timestamptz) from public, anon, authenticated, service_role;
