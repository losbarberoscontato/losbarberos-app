-- Cast the status CASE to the cycle enum, and only mark upfront cycles paid
-- after setting paid_at so the table check is satisfied atomically.
create or replace function public.accept_customer_subscription_offer(
  p_organization_id uuid,
  p_subscription_id uuid
)
returns public.customer_subscriptions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub public.customer_subscriptions%rowtype;
  v_plan public.subscription_plan_versions%rowtype;
  v_cycle public.customer_subscription_cycles%rowtype;
  v_timezone text;
  v_start_date date;
  v_first_due_date date;
  v_cycle_count integer;
  v_start date;
  v_end date;
  v_due date;
  i integer;
  j integer;
begin
  select * into strict v_sub
    from public.customer_subscriptions
   where id = p_subscription_id
     and organization_id = p_organization_id
   for update;

  if not public.is_organization_customer(p_organization_id, v_sub.customer_id) then
    raise exception using errcode = '42501', message = 'subscription offer acceptance denied';
  end if;

  if v_sub.status = 'ACTIVE' and v_sub.contract_accepted_by = auth.uid() then
    return v_sub;
  end if;
  if v_sub.status <> 'REQUESTED' or v_sub.contract_accepted_at is not null then
    raise exception using errcode = '22023', message = 'subscription offer is not awaiting acceptance';
  end if;

  select * into strict v_plan
    from public.subscription_plan_versions
   where id = v_sub.plan_version_id
     and organization_id = p_organization_id;
  select timezone into strict v_timezone
    from public.organizations
   where id = p_organization_id;

  v_start_date := (now() at time zone v_timezone)::date;
  v_first_due_date := v_start_date;
  v_cycle_count := case
    when v_plan.billing_period = 'BIWEEKLY' then v_plan.duration_months * 2
    else v_plan.duration_months
  end;

  update public.customer_subscriptions
     set status = 'ACTIVE',
         contract_accepted_at = now(),
         contract_accepted_by = auth.uid(),
         start_date = v_start_date,
         end_date = case
           when v_plan.billing_period = 'BIWEEKLY'
             then v_start_date + (v_cycle_count * 15 - 1)
           else (v_start_date + (v_plan.duration_months || ' months')::interval - interval '1 day')::date
         end,
         first_due_date = v_first_due_date,
         due_day = extract(day from v_first_due_date)::smallint,
         updated_at = now()
   where id = v_sub.id
     and organization_id = p_organization_id
  returning * into v_sub;

  insert into public.subscription_contract_acceptances(
    organization_id, subscription_id, contract_version, accepted_by, acceptance_source
  ) values (
    p_organization_id, v_sub.id, v_sub.contract_version, auth.uid(), 'CLIENT_OFFER'
  ) on conflict (subscription_id, contract_version) do nothing;

  for i in 1..v_cycle_count loop
    v_start := case
      when v_plan.billing_period = 'BIWEEKLY' then v_start_date + ((i - 1) * 15)
      else (v_start_date + ((i - 1) || ' months')::interval)::date
    end;
    v_end := case
      when v_plan.billing_period = 'BIWEEKLY' then v_start + 14
      else (v_start + interval '1 month' - interval '1 day')::date
    end;
    v_due := case
      when i = 1 then v_first_due_date
      when v_plan.billing_period = 'BIWEEKLY' then v_first_due_date + ((i - 1) * 15)
      else make_date(
        extract(year from v_start)::int,
        extract(month from v_start)::int,
        least(v_sub.due_day, extract(day from (date_trunc('month', v_start) + interval '1 month - 1 day'))::int)
      )
    end;

    insert into public.customer_subscription_cycles(
      organization_id, subscription_id, cycle_number, starts_on, ends_on, due_on, amount_cents, status
    ) values (
      p_organization_id, v_sub.id, i, v_start, v_end, v_due, v_plan.price_cents,
      'OPEN'::public.subscription_cycle_status
    ) returning * into v_cycle;

    if v_sub.upfront_payment then
      update public.customer_subscription_cycles
         set status = 'PAID', paid_at = now()
       where id = v_cycle.id
         and organization_id = p_organization_id;
    end if;

    for j in 1..v_plan.sessions_per_cycle loop
      insert into public.customer_subscription_sessions(
        organization_id, subscription_id, cycle_id, session_number, available_until
      ) values (
        p_organization_id, v_sub.id, v_cycle.id, j, v_end
      );
    end loop;
  end loop;

  insert into public.subscription_events(
    organization_id, subscription_id, event_type, actor_user_id, idempotency_key, metadata
  ) values (
    p_organization_id, v_sub.id, 'ACTIVATED', auth.uid(),
    'client-offer-activated:' || v_sub.id,
    jsonb_build_object('acceptance_source', 'CLIENT_OFFER')
  ) on conflict (organization_id, idempotency_key) do nothing;

  update public.customer_in_app_notifications
     set read_at = coalesce(read_at, now())
   where organization_id = p_organization_id
     and customer_id = v_sub.customer_id
     and subscription_id = v_sub.id;

  return v_sub;
end;
$$;

revoke all on function public.accept_customer_subscription_offer(uuid, uuid) from public, anon;
grant execute on function public.accept_customer_subscription_offer(uuid, uuid) to authenticated;
