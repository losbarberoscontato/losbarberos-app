alter table public.subscription_plan_versions
  add column scheduling_mode text not null default 'FREE'
  check (scheduling_mode in ('FREE', 'FIXED'));

alter table public.customer_subscriptions
  add column fixed_schedule_cadence_weeks smallint,
  add column fixed_schedule_start_date date,
  add column fixed_schedule_local_time time,
  add column fixed_schedule_barber_id uuid,
  add column fixed_schedule_timezone text,
  add column fixed_schedule_created_at timestamptz,
  add constraint customer_subscriptions_fixed_schedule_complete check (
    (fixed_schedule_cadence_weeks is null and fixed_schedule_start_date is null
      and fixed_schedule_local_time is null and fixed_schedule_barber_id is null
      and fixed_schedule_timezone is null)
    or (fixed_schedule_cadence_weeks in (1, 2) and fixed_schedule_start_date is not null
      and fixed_schedule_local_time is not null and fixed_schedule_barber_id is not null
      and fixed_schedule_timezone is not null)
  ),
  add constraint customer_subscriptions_fixed_barber_fk
    foreign key (fixed_schedule_barber_id, organization_id)
    references public.barbers(id, organization_id);

create or replace function public.save_subscription_plan(
  p_organization_id uuid,
  p_plan_id uuid,
  p_name text,
  p_description text,
  p_price_cents bigint,
  p_billing_period public.subscription_billing_period,
  p_duration_months smallint,
  p_sessions_per_cycle smallint,
  p_payment_method public.subscription_payment_method,
  p_cancellation_policy text,
  p_session_cancellation_policy text,
  p_services jsonb,
  p_scheduling_mode text
)
returns public.subscription_plans
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_plan public.subscription_plans;
begin
  if p_scheduling_mode not in ('FREE', 'FIXED') then
    raise exception using errcode = '22023', message = 'invalid subscription scheduling mode';
  end if;
  v_plan := public.save_subscription_plan(
    p_organization_id, p_plan_id, p_name, p_description, p_price_cents,
    p_billing_period, p_duration_months, p_sessions_per_cycle, p_payment_method,
    p_cancellation_policy, p_session_cancellation_policy, p_services
  );
  update public.subscription_plan_versions
     set scheduling_mode = p_scheduling_mode
   where id = (
     select version.id from public.subscription_plan_versions version
      where version.organization_id = p_organization_id and version.plan_id = v_plan.id
      order by version.version desc limit 1
   );
  return v_plan;
end;
$$;

revoke all on function public.save_subscription_plan(
  uuid, uuid, text, text, bigint, public.subscription_billing_period,
  smallint, smallint, public.subscription_payment_method, text, text, jsonb, text
) from public, anon;
grant execute on function public.save_subscription_plan(
  uuid, uuid, text, text, bigint, public.subscription_billing_period,
  smallint, smallint, public.subscription_payment_method, text, text, jsonb, text
) to authenticated;

create or replace function public.fixed_subscription_schedule_preview(
  p_organization_id uuid,
  p_plan_version_id uuid,
  p_barber_id uuid,
  p_start_date date,
  p_local_time time,
  p_cadence_weeks smallint,
  p_timezone text
)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_plan public.subscription_plan_versions%rowtype;
  v_org public.organizations%rowtype;
  v_items jsonb;
  v_resolution jsonb;
  v_session_count integer;
  v_occupied_minutes integer;
  v_date date := p_start_date;
  v_start timestamptz;
  v_period tstzrange;
  v_index integer;
  v_attempt integer;
  v_found boolean;
  v_result jsonb := '[]'::jsonb;
begin
  if p_cadence_weeks not in (1, 2) or p_start_date is null or p_local_time is null then
    raise exception using errcode = '22023', message = 'invalid fixed subscription schedule';
  end if;
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception using errcode = '22023', message = 'invalid organization timezone';
  end if;
  select * into strict v_org from public.organizations where id = p_organization_id;
  select * into strict v_plan from public.subscription_plan_versions
   where id = p_plan_version_id and organization_id = p_organization_id;
  if v_plan.scheduling_mode <> 'FIXED' then
    raise exception using errcode = '22023', message = 'subscription plan does not use fixed scheduling';
  end if;
  if not exists (
    select 1 from public.barbers b
     where b.id = p_barber_id and b.organization_id = p_organization_id and b.active
  ) then
    raise exception using errcode = '22023', message = 'fixed schedule barber is inactive';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('type', 'SERVICE', 'service_id', service_id, 'quantity', 1) order by position), '[]'::jsonb)
    into v_items
    from public.subscription_plan_services
   where organization_id = p_organization_id and plan_version_id = v_plan.id;
  if jsonb_array_length(v_items) = 0 then
    raise exception using errcode = '22023', message = 'fixed subscription plan has no services';
  end if;
  v_resolution := public.resolve_booking_selection(p_organization_id, p_barber_id, v_items, null);
  v_occupied_minutes := ceil((v_resolution ->> 'duration_minutes')::numeric / v_org.slot_interval_minutes)::integer
    * v_org.slot_interval_minutes;
  v_session_count := v_plan.sessions_per_cycle *
    case when v_plan.billing_period = 'BIWEEKLY' then v_plan.duration_months * 2 else v_plan.duration_months end;

  for v_index in 1..v_session_count loop
    v_found := false;
    for v_attempt in 1..520 loop
      v_start := (v_date + p_local_time) at time zone p_timezone;
      v_period := tstzrange(v_start, v_start + make_interval(mins => v_occupied_minutes), '[)');
      if v_start <= now() or public.organization_date_blocked(p_organization_id, v_period) then
        v_date := v_date + (p_cadence_weeks * 7);
        continue;
      end if;
      if not public.is_barber_available(p_organization_id, p_barber_id, v_period) then
        raise exception using errcode = '23P01', message = 'fixed_schedule_conflict: escolha outra data, hora ou profissional';
      end if;
      v_found := true;
      exit;
    end loop;
    if not v_found then
      raise exception using errcode = '23P01', message = 'fixed_schedule_conflict: não foi possível encontrar datas sem bloqueio';
    end if;
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'local_date', v_date,
      'starts_at', v_start
    ));
    v_date := v_date + (p_cadence_weeks * 7);
  end loop;
  return v_result;
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'organization, plan or barber not found';
end;
$$;

revoke all on function public.fixed_subscription_schedule_preview(uuid, uuid, uuid, date, time, smallint, text) from public, anon, authenticated;

create or replace function public.request_customer_fixed_subscription(
  p_organization_id uuid,
  p_customer_id uuid,
  p_plan_id uuid,
  p_cadence_weeks smallint,
  p_start_date date,
  p_local_time time,
  p_barber_id uuid,
  p_acceptance_source text default 'CLIENT',
  p_accept_contract boolean default true
)
returns public.customer_subscriptions
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_sub public.customer_subscriptions%rowtype;
  v_plan public.subscription_plan_versions%rowtype;
  v_timezone text;
begin
  if not (public.is_organization_owner(p_organization_id)
    or public.is_organization_customer(p_organization_id, p_customer_id)) then
    raise exception using errcode = '42501', message = 'subscription request denied';
  end if;
  select * into strict v_plan from public.subscription_plan_versions
   where organization_id = p_organization_id and plan_id = p_plan_id
   order by version desc limit 1;
  if v_plan.scheduling_mode <> 'FIXED' then
    raise exception using errcode = '22023', message = 'subscription plan does not use fixed scheduling';
  end if;
  select timezone into strict v_timezone from public.organizations where id = p_organization_id;
  v_sub := public.request_customer_subscription(
    p_organization_id, p_customer_id, p_plan_id, p_acceptance_source, p_accept_contract
  );
  perform public.fixed_subscription_schedule_preview(
    p_organization_id, v_plan.id, p_barber_id, p_start_date, p_local_time,
    p_cadence_weeks, v_timezone
  );
  update public.customer_subscriptions
     set fixed_schedule_cadence_weeks = p_cadence_weeks,
         fixed_schedule_start_date = p_start_date,
         fixed_schedule_local_time = p_local_time,
         fixed_schedule_barber_id = p_barber_id,
         fixed_schedule_timezone = v_timezone
   where id = v_sub.id and organization_id = p_organization_id
  returning * into v_sub;
  return v_sub;
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'organization or subscription plan not found';
end;
$$;

create or replace function public.update_customer_fixed_subscription_schedule(
  p_organization_id uuid,
  p_subscription_id uuid,
  p_cadence_weeks smallint,
  p_start_date date,
  p_local_time time,
  p_barber_id uuid
)
returns public.customer_subscriptions
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_sub public.customer_subscriptions%rowtype;
  v_plan public.subscription_plan_versions%rowtype;
  v_timezone text;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'subscription schedule update denied';
  end if;
  select * into strict v_sub from public.customer_subscriptions
   where id = p_subscription_id and organization_id = p_organization_id for update;
  if v_sub.status not in ('REQUESTED', 'PENDING_PAYMENT') or v_sub.fixed_schedule_created_at is not null then
    raise exception using errcode = '22023', message = 'fixed subscription schedule is no longer editable';
  end if;
  select * into strict v_plan from public.subscription_plan_versions
   where id = v_sub.plan_version_id and organization_id = p_organization_id;
  select timezone into strict v_timezone from public.organizations where id = p_organization_id;
  perform public.fixed_subscription_schedule_preview(
    p_organization_id, v_plan.id, p_barber_id, p_start_date, p_local_time,
    p_cadence_weeks, v_timezone
  );
  update public.customer_subscriptions
     set fixed_schedule_cadence_weeks = p_cadence_weeks,
         fixed_schedule_start_date = p_start_date,
         fixed_schedule_local_time = p_local_time,
         fixed_schedule_barber_id = p_barber_id,
         fixed_schedule_timezone = v_timezone,
         updated_at = now()
   where id = v_sub.id and organization_id = p_organization_id
  returning * into v_sub;
  return v_sub;
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'subscription, plan or barber not found';
end;
$$;

create or replace function public.schedule_fixed_subscription_sessions(
  p_organization_id uuid,
  p_subscription_id uuid
)
returns integer
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_sub public.customer_subscriptions%rowtype;
  v_plan public.subscription_plan_versions%rowtype;
  v_session public.customer_subscription_sessions%rowtype;
  v_schedule jsonb;
  v_items jsonb;
  v_appointment_id uuid;
  v_count integer := 0;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'subscription schedule generation denied';
  end if;
  select * into strict v_sub from public.customer_subscriptions
   where id = p_subscription_id and organization_id = p_organization_id for update;
  select * into strict v_plan from public.subscription_plan_versions
   where id = v_sub.plan_version_id and organization_id = p_organization_id;
  if v_plan.scheduling_mode <> 'FIXED' then return 0; end if;
  if v_sub.status <> 'ACTIVE' or v_sub.fixed_schedule_created_at is not null then return 0; end if;
  if v_sub.fixed_schedule_cadence_weeks is null then
    raise exception using errcode = '22023', message = 'fixed subscription schedule is missing';
  end if;
  perform 1 from public.organizations where id = p_organization_id for update;
  if not public.organization_accepts_new_bookings(p_organization_id) then
    raise exception using errcode = '22023', message = 'organization is not accepting new bookings';
  end if;
  v_schedule := public.fixed_subscription_schedule_preview(
    p_organization_id, v_plan.id, v_sub.fixed_schedule_barber_id,
    v_sub.fixed_schedule_start_date, v_sub.fixed_schedule_local_time,
    v_sub.fixed_schedule_cadence_weeks, v_sub.fixed_schedule_timezone
  );
  select coalesce(jsonb_agg(jsonb_build_object('type', 'SERVICE', 'service_id', service_id, 'quantity', 1) order by position), '[]'::jsonb)
    into v_items
    from public.subscription_plan_services
   where organization_id = p_organization_id and plan_version_id = v_plan.id;
  for v_session in
    select session.*
      from public.customer_subscription_sessions session
      join public.customer_subscription_cycles cycle
        on cycle.id = session.cycle_id and cycle.organization_id = session.organization_id
     where session.organization_id = p_organization_id
       and session.subscription_id = p_subscription_id
       and session.status = 'AVAILABLE'
     order by cycle.cycle_number, session.session_number
     for update of session
  loop
    begin
      v_appointment_id := public.create_manual_appointment(
        p_organization_id, v_sub.customer_id, v_sub.fixed_schedule_barber_id,
        (v_schedule -> (v_count) ->> 'starts_at')::timestamptz,
        v_items, null, 'Sessão de plano de assinatura'
      );
    exception
      when exclusion_violation or check_violation then
        raise exception using errcode = '23P01', message = 'fixed_schedule_conflict: escolha outra data, hora ou profissional';
      when invalid_parameter_value then
        raise exception using errcode = '23P01', message = 'fixed_schedule_conflict: escolha outra data, hora ou profissional';
    end;
    update public.appointments
       set subscription_session_id = v_session.id,
           payment_mode = 'SUBSCRIPTION', total_cents_snapshot = 0,
           list_total_cents_snapshot = 0, deposit_required_cents_snapshot = 0,
           amount_waived_cents = 0, hold_expires_at = null,
           notes = concat_ws(E'\n', notes, 'Sessão assinatura')
     where id = v_appointment_id and organization_id = p_organization_id;
    update public.customer_subscription_sessions
       set status = 'SCHEDULED', appointment_id = v_appointment_id
     where id = v_session.id and organization_id = p_organization_id and status = 'AVAILABLE';
    if not found then
      raise exception using errcode = '40001', message = 'subscription session changed while scheduling';
    end if;
    v_count := v_count + 1;
  end loop;
  if v_count <> jsonb_array_length(v_schedule) then
    raise exception using errcode = '40001', message = 'fixed subscription session count changed';
  end if;
  update public.customer_subscriptions
     set fixed_schedule_created_at = now(), updated_at = now()
   where id = p_subscription_id and organization_id = p_organization_id;
  return v_count;
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'subscription or plan not found';
end;
$$;

revoke all on function public.schedule_fixed_subscription_sessions(uuid, uuid) from public, anon, authenticated;

create or replace function public.record_subscription_payment(
  p_organization_id uuid,
  p_subscription_id uuid,
  p_cycle_id uuid,
  p_amount_cents bigint,
  p_method public.subscription_payment_method,
  p_idempotency_key text,
  p_chart_account_id uuid,
  p_financial_account_id uuid default null,
  p_external_reference text default null,
  p_paid_on date default current_date
)
returns public.subscription_payments
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_sub public.customer_subscriptions%rowtype;
  v_cycle public.customer_subscription_cycles%rowtype;
  v_payment public.subscription_payments;
  v_entry uuid;
  v_required bigint;
  v_financial_method public.financial_payment_method;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'subscription payment denied';
  end if;
  if p_amount_cents <= 0 or nullif(btrim(p_idempotency_key), '') is null then
    raise exception using errcode = '22023', message = 'positive amount and idempotency key are required';
  end if;
  select * into strict v_sub from public.customer_subscriptions
   where id = p_subscription_id and organization_id = p_organization_id for update;
  select * into strict v_cycle from public.customer_subscription_cycles
   where id = p_cycle_id and subscription_id = v_sub.id and organization_id = p_organization_id for update;
  if v_cycle.status not in ('OPEN', 'OVERDUE') then
    raise exception using errcode = '22023', message = 'subscription cycle is not payable';
  end if;
  select coalesce(sum(amount_cents), 0)::bigint into v_required
    from public.customer_subscription_cycles
   where subscription_id = v_sub.id and organization_id = p_organization_id
     and status in ('OPEN', 'OVERDUE');
  if not v_sub.upfront_payment then v_required := v_cycle.amount_cents; end if;
  if p_amount_cents <> v_required then
    raise exception using errcode = '22023', message = 'subscription payment amount does not match payable balance';
  end if;
  if p_financial_account_id is null then
    raise exception using errcode = '22023', message = 'active financial account is required';
  end if;
  if exists (select 1 from public.subscription_payments
    where organization_id = p_organization_id and idempotency_key = p_idempotency_key) then
    return (select payment from public.subscription_payments payment
      where payment.organization_id = p_organization_id and payment.idempotency_key = p_idempotency_key);
  end if;
  v_financial_method := case p_method
    when 'CARD' then 'CARD'::public.financial_payment_method
    when 'PIX' then 'PIX'::public.financial_payment_method
    when 'BOLETO' then 'BOLETO'::public.financial_payment_method
    when 'CASH' then 'CASH'::public.financial_payment_method
    else 'OTHER'::public.financial_payment_method
  end;
  insert into public.financial_entries(
    organization_id, kind, source, description, issue_date, competence_date, due_date,
    total_cents, currency, chart_account_id, preferred_financial_account_id,
    counterparty_kind, customer_id, subscription_cycle_id, created_by
  ) values (
    p_organization_id, 'REVENUE', 'SUBSCRIPTION',
    public.subscription_financial_entry_description(v_cycle.id),
    least(coalesce(p_paid_on, current_date), v_cycle.due_on),
    least(coalesce(p_paid_on, current_date), v_cycle.due_on), v_cycle.due_on,
    p_amount_cents, 'BRL', p_chart_account_id, p_financial_account_id,
    'CUSTOMER', v_sub.customer_id, v_cycle.id, auth.uid()
  ) returning id into v_entry;
  perform public.settle_financial_entry(
    v_entry, p_financial_account_id, p_amount_cents,
    coalesce(p_paid_on, current_date), v_financial_method, p_external_reference,
    'subscription-payment-settlement:' || p_idempotency_key
  );
  insert into public.subscription_payments(
    organization_id, subscription_id, cycle_id, amount_cents, method,
    idempotency_key, external_reference, created_by
  ) values (
    p_organization_id, v_sub.id, v_cycle.id, p_amount_cents, p_method,
    p_idempotency_key, p_external_reference, auth.uid()
  ) returning * into v_payment;
  if v_sub.upfront_payment then
    update public.customer_subscription_cycles
       set status = 'PAID', paid_at = now(), financial_entry_id = v_entry
     where subscription_id = v_sub.id and organization_id = p_organization_id
       and status in ('OPEN', 'OVERDUE');
  else
    update public.customer_subscription_cycles
       set status = 'PAID', paid_at = now(), financial_entry_id = v_entry
     where id = v_cycle.id;
  end if;
  if v_sub.status = 'PENDING_PAYMENT' and v_cycle.cycle_number = 1 then
    update public.customer_subscriptions
       set status = 'ACTIVE', updated_at = now()
     where id = v_sub.id and organization_id = p_organization_id;
  end if;
  -- This also handles UPFRONT subscriptions, whose activation marks cycles
  -- paid before the manager records the single collected payment.
  perform public.schedule_fixed_subscription_sessions(p_organization_id, v_sub.id);
  return v_payment;
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'subscription or cycle not found';
end;
$$;

revoke all on function public.record_subscription_payment(
  uuid, uuid, uuid, bigint, public.subscription_payment_method, text, uuid, uuid, text, date
) from public, anon;
grant execute on function public.record_subscription_payment(
  uuid, uuid, uuid, bigint, public.subscription_payment_method, text, uuid, uuid, text, date
) to authenticated;

revoke all on function public.request_customer_fixed_subscription(uuid, uuid, uuid, smallint, date, time, uuid, text, boolean) from public, anon;
grant execute on function public.request_customer_fixed_subscription(uuid, uuid, uuid, smallint, date, time, uuid, text, boolean) to authenticated;
revoke all on function public.update_customer_fixed_subscription_schedule(uuid, uuid, smallint, date, time, uuid) from public, anon;
grant execute on function public.update_customer_fixed_subscription_schedule(uuid, uuid, smallint, date, time, uuid) to authenticated;
