-- Free scheduling rules. Existing fixed reservations are deliberately untouched.
create table public.subscription_overdue_booking_overrides (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null,
  subscription_session_id uuid not null,
  actor_user_id uuid not null references auth.users(id),
  reason text not null check (char_length(btrim(reason)) between 5 and 1000),
  created_at timestamptz not null default now(),
  foreign key (customer_id, organization_id) references public.customers(id, organization_id),
  foreign key (subscription_session_id, organization_id) references public.customer_subscription_sessions(id, organization_id)
);
alter table public.subscription_overdue_booking_overrides enable row level security;
alter table public.subscription_overdue_booking_overrides force row level security;
create policy subscription_overdue_booking_overrides_owner_read
  on public.subscription_overdue_booking_overrides for select to authenticated
  using (public.is_organization_owner(organization_id));
grant select on public.subscription_overdue_booking_overrides to authenticated;

create function public.book_subscription_session_guarded(
  p_organization_id uuid, p_customer_id uuid, p_subscription_session_id uuid,
  p_barber_id uuid, p_starts_at timestamptz, p_overdue_reason text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_subscription_id uuid;
  v_plan_id uuid;
  v_scheduling_mode text;
  v_previous_status public.subscription_session_status;
  v_overdue boolean;
  v_today date;
begin
  select s.subscription_id, sub.plan_id, plan.scheduling_mode
    into strict v_subscription_id, v_plan_id, v_scheduling_mode
  from public.customer_subscription_sessions s
  join public.customer_subscriptions sub on sub.id = s.subscription_id and sub.organization_id = s.organization_id
  join public.subscription_plan_versions version on version.id = sub.plan_version_id and version.organization_id = sub.organization_id
  join public.subscription_plans plan on plan.id = version.plan_id and plan.organization_id = version.organization_id
  where s.id = p_subscription_session_id and s.organization_id = p_organization_id and sub.customer_id = p_customer_id
  for update of s, sub;

  if not exists (
    select 1 from public.barber_subscription_plans assignment
    where assignment.organization_id = p_organization_id and assignment.barber_id = p_barber_id
      and assignment.plan_id = v_plan_id and assignment.active
  ) then
    raise exception using errcode = '22023', message = 'professional is not configured for this subscription plan';
  end if;

  select (now() at time zone o.timezone)::date into v_today
  from public.organizations o where o.id = p_organization_id;
  select exists (
    select 1 from public.customer_subscription_cycles cycle
    join public.customer_subscriptions sub on sub.id = cycle.subscription_id and sub.organization_id = cycle.organization_id
    where sub.organization_id = p_organization_id and sub.customer_id = p_customer_id
      and cycle.due_on < v_today and cycle.status in ('OPEN', 'OVERDUE')
  ) into v_overdue;

  if v_overdue then
    if p_overdue_reason is null then
      raise exception using errcode = '22023', message = 'subscription_overdue_installment';
    end if;
    if not public.is_organization_owner(p_organization_id) then
      raise exception using errcode = '42501', message = 'manager overdue override required';
    end if;
    if char_length(btrim(p_overdue_reason)) not between 5 and 1000 then
      raise exception using errcode = '22023', message = 'overdue override reason required';
    end if;
  end if;

  if v_scheduling_mode = 'FREE' then
    select previous.status into v_previous_status from (
      select session.id, lag(session.status) over (order by cycle.cycle_number, session.session_number) as status
      from public.customer_subscription_sessions session
      join public.customer_subscription_cycles cycle on cycle.id = session.cycle_id and cycle.organization_id = session.organization_id
      where session.organization_id = p_organization_id and session.subscription_id = v_subscription_id
    ) previous where previous.id = p_subscription_session_id;
    if v_previous_status is not null and v_previous_status not in ('COMPLETED', 'CONSUMED') then
      raise exception using errcode = '22023', message = 'previous_subscription_session_not_finished';
    end if;
  end if;

  -- Both the appointment and audit row commit together or neither does.
  if v_overdue then
    insert into public.subscription_overdue_booking_overrides(
      organization_id, customer_id, subscription_session_id, actor_user_id, reason
    ) values (p_organization_id, p_customer_id, p_subscription_session_id, auth.uid(), btrim(p_overdue_reason));
  end if;
  return public.book_customer_subscription_session_before_catalog_commissions(
    p_organization_id, p_customer_id, p_subscription_session_id, p_barber_id, p_starts_at
  );
exception when no_data_found then
  raise exception using errcode = 'P0002', message = 'subscription session not found';
end $$;
revoke all on function public.book_subscription_session_guarded(uuid,uuid,uuid,uuid,timestamptz,text) from public, anon, authenticated, service_role;

create or replace function public.book_customer_subscription_session(
  p_organization_id uuid, p_customer_id uuid, p_subscription_session_id uuid,
  p_barber_id uuid, p_starts_at timestamptz
) returns jsonb language sql security definer set search_path = public, pg_temp as $$
  select public.book_subscription_session_guarded($1,$2,$3,$4,$5,null);
$$;

create function public.book_customer_subscription_session_with_overdue_override(
  p_organization_id uuid, p_customer_id uuid, p_subscription_session_id uuid,
  p_barber_id uuid, p_starts_at timestamptz, p_reason text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'manager overdue override required';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 5 and 1000 then
    raise exception using errcode = '22023', message = 'overdue override reason required';
  end if;
  return public.book_subscription_session_guarded($1,$2,$3,$4,$5,$6);
end $$;
revoke all on function public.book_customer_subscription_session_with_overdue_override(uuid,uuid,uuid,uuid,timestamptz,text) from public, anon;
grant execute on function public.book_customer_subscription_session_with_overdue_override(uuid,uuid,uuid,uuid,timestamptz,text) to authenticated;
