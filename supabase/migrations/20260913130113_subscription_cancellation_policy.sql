-- Política unificada de cancelamento para agenda, assinaturas e cancelamento via WhatsApp.
-- Agendamentos existentes preservam outcome nulo e continuam exibindo "Cancelado".
alter table public.appointments
  add column if not exists cancellation_outcome text,
  add column if not exists cancellation_actor_name text;

alter table public.appointments
  drop constraint if exists appointments_cancellation_outcome_check;
alter table public.appointments
  add constraint appointments_cancellation_outcome_check
  check (cancellation_outcome is null or cancellation_outcome in ('ON_TIME', 'AFTER_DEADLINE'));

create or replace function public.subscription_cancellation_outcome(
  p_service_period tstzrange,
  p_lead_minutes integer
)
returns text
language sql
stable
as $$
  select case
    when coalesce(p_lead_minutes, 0) = 0 then 'ON_TIME'
    when now() <= lower(p_service_period) - make_interval(mins => greatest(coalesce(p_lead_minutes, 0), 0)) then 'ON_TIME'
    else 'AFTER_DEADLINE'
  end;
$$;

create or replace function public.cancel_appointment(
  p_appointment_id uuid,
  p_reason text,
  p_requested_by_customer boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_appointment public.appointments%rowtype;
  v_net_paid bigint;
  v_refund_amount bigint;
  v_refund_order_id uuid;
  v_provider public.payment_provider;
  v_outcome text;
  v_actor_name text;
  v_cancelled_at timestamptz := now();
begin
  select * into strict v_appointment
    from public.appointments where id = p_appointment_id for update;
  if not (
    coalesce(auth.role(), '') = 'service_role'
    or public.is_organization_owner(v_appointment.organization_id)
    or (p_requested_by_customer and public.is_organization_customer(v_appointment.organization_id, v_appointment.customer_id))
  ) then
    raise exception using errcode = '42501', message = 'appointment cancellation denied';
  end if;
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.organization_allows_existing_operations(v_appointment.organization_id) then
    raise exception using errcode = '42501', message = 'organization access does not allow appointment operations';
  end if;
  if v_appointment.status not in ('HELD', 'PENDING_PAYMENT', 'CONFIRMED') then
    raise exception using errcode = '22023', message = 'appointment cannot be canceled';
  end if;

  v_outcome := public.subscription_cancellation_outcome(
    v_appointment.service_period,
    v_appointment.cancellation_lead_minutes_snapshot
  );
  if p_requested_by_customer then
    v_actor_name := 'Próprio cliente';
  else
    select nullif(trim(display_name), '') into v_actor_name
      from public.profiles where id = auth.uid();
    v_actor_name := coalesce(v_actor_name, 'Usuário autenticado');
  end if;

  select coalesce(sum(case
    when kind in ('CAPTURE', 'ADJUSTMENT') then amount_cents
    when kind in ('REFUND', 'REVERSAL') then -amount_cents
  end), 0)::bigint into v_net_paid
    from public.payment_transactions
   where appointment_id = v_appointment.id
     and organization_id = v_appointment.organization_id;
  v_net_paid := greatest(v_net_paid, 0);
  v_refund_amount := case
    when v_outcome = 'ON_TIME' then v_net_paid
    else greatest(v_net_paid - v_appointment.deposit_required_cents_snapshot, 0)
  end;

  update public.appointments
     set status = 'CANCELED', hold_expires_at = null,
         amount_waived_cents = total_cents_snapshot, version = version + 1,
         cancellation_outcome = v_outcome,
         cancellation_actor_name = v_actor_name,
         cancelled_at = v_cancelled_at,
         cancellation_source = case when p_requested_by_customer then 'CLIENT_APP' else 'MANAGER' end
   where id = v_appointment.id;
  insert into public.appointment_status_events (
    organization_id, appointment_id, from_status, to_status, reason, actor_user_id, metadata
  ) values (
    v_appointment.organization_id, v_appointment.id, v_appointment.status, 'CANCELED',
    left(coalesce(p_reason, 'Cancelamento solicitado'), 500), auth.uid(),
    jsonb_build_object('cancellation_outcome', v_outcome, 'cancellation_actor_name', v_actor_name, 'cancelled_at', v_cancelled_at)
  );

  update public.payment_orders
     set status = 'CANCELED', failure_code = 'APPOINTMENT_CANCELED',
         failure_message = 'Uncaptured payment canceled with appointment'
   where appointment_id = v_appointment.id
     and organization_id = v_appointment.organization_id
     and kind in ('DEPOSIT', 'FULL', 'BALANCE')
     and status in ('CREATED', 'PENDING', 'REQUIRES_ACTION');

  if v_refund_amount > 0 then
    select provider into v_provider
      from public.payment_transactions
     where appointment_id = v_appointment.id
       and organization_id = v_appointment.organization_id
       and kind = 'CAPTURE'
     order by occurred_at desc limit 1;
    v_provider := coalesce(v_provider, 'MANUAL');
    insert into public.payment_orders (
      organization_id, appointment_id, provider, kind, status, amount_cents, currency, idempotency_key, metadata
    ) values (
      v_appointment.organization_id, v_appointment.id, v_provider, 'REFUND',
      case when v_provider = 'MERCADO_PAGO' then 'CREATED'::public.payment_order_status else 'REQUIRES_ACTION'::public.payment_order_status end,
      v_refund_amount, v_appointment.currency,
      'cancellation-refund:' || v_appointment.id || ':v' || (v_appointment.version + 1),
      jsonb_build_object('reason', p_reason, 'cancellation_outcome', v_outcome)
    ) returning id into v_refund_order_id;
  end if;

  return jsonb_build_object(
    'appointment_id', v_appointment.id,
    'status', 'CANCELED',
    'refund_amount_cents', v_refund_amount,
    'refund_order_id', v_refund_order_id,
    'cancellation_outcome', v_outcome,
    'cancellation_actor_name', v_actor_name,
    'cancelled_at', v_cancelled_at
  );
exception when no_data_found then
  raise exception using errcode = 'P0002', message = 'appointment not found';
end;
$$;

create or replace function public.return_subscription_session_after_staff_cancel()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'CANCELED' and new.subscription_session_id is not null then
    update public.customer_subscription_sessions
       set status = case when coalesce(new.cancellation_outcome, 'AFTER_DEADLINE') = 'ON_TIME' then 'AVAILABLE' else 'CANCELED' end,
           appointment_id = null,
           canceled_at = coalesce(new.cancelled_at, now()),
           consumed_at = case when coalesce(new.cancellation_outcome, 'AFTER_DEADLINE') = 'ON_TIME' then null else coalesce(new.cancelled_at, now()) end
     where id = new.subscription_session_id
       and organization_id = new.organization_id
       and status = 'SCHEDULED';
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_subscription_staff_cancel on public.appointments;
create trigger appointments_subscription_staff_cancel
after update of status on public.appointments
for each row when (new.status = 'CANCELED' and old.status is distinct from new.status)
execute function public.return_subscription_session_after_staff_cancel();

create or replace function public.cancel_customer_subscription_session(
  p_organization_id uuid,
  p_customer_id uuid,
  p_subscription_session_id uuid,
  p_reason text default 'Cancelada pelo cliente'
)
returns public.customer_subscription_sessions
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_session public.customer_subscription_sessions%rowtype;
  v_appointment public.appointments%rowtype;
begin
  if not public.is_organization_customer(p_organization_id, p_customer_id) then
    raise exception using errcode = '42501', message = 'session cancellation denied';
  end if;
  select * into strict v_session from public.customer_subscription_sessions
   where id = p_subscription_session_id and organization_id = p_organization_id for update;
  if v_session.status <> 'SCHEDULED' or v_session.appointment_id is null then
    raise exception using errcode = '22023', message = 'subscription session is not scheduled';
  end if;
  select * into strict v_appointment from public.appointments
   where id = v_session.appointment_id and organization_id = p_organization_id for update;
  perform public.cancel_appointment(v_appointment.id, left(coalesce(p_reason, 'Cancelada pelo cliente'), 500), true);
  update public.notification_outbox
     set payload = payload || jsonb_build_object(
       'subscription_session', true,
       'subscription_session_status', (select status::text from public.customer_subscription_sessions where id = v_session.id),
       'session_returned', (select status = 'AVAILABLE' from public.customer_subscription_sessions where id = v_session.id)
     )
   where organization_id = p_organization_id and appointment_id = v_appointment.id
     and template_key = 'appointment_canceled' and status in ('PENDING', 'FAILED');
  return (select s from public.customer_subscription_sessions s where s.id = v_session.id and s.organization_id = p_organization_id);
exception when no_data_found then
  raise exception using errcode = 'P0002', message = 'subscription session not found';
end;
$$;

create or replace function public.consume_subscription_session_after_appointment_transition()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if new.subscription_session_id is not null
     and new.status in ('COMPLETED', 'NO_SHOW')
     and old.status is distinct from new.status then
    update public.customer_subscription_sessions
       set status = case when new.status = 'COMPLETED' then 'COMPLETED' else 'CANCELED' end,
           consumed_at = coalesce(consumed_at, now()),
           canceled_at = case when new.status = 'NO_SHOW' then coalesce(canceled_at, now()) else canceled_at end
     where id = new.subscription_session_id
       and organization_id = new.organization_id
       and status = 'SCHEDULED';
  end if;
  return new;
end;
$$;

create or replace function public.barber_cancel_appointment(p_appointment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_appointment public.appointments%rowtype;
  v_paid bigint;
  v_outcome text;
  v_actor_name text;
begin
  select * into strict v_appointment from public.appointments where id = p_appointment_id for update;
  if not public.can_operate_barber_agenda(v_appointment.organization_id, v_appointment.barber_id) then
    raise exception using errcode = '42501', message = 'barber agenda access denied';
  end if;
  if v_appointment.status not in ('CONFIRMED', 'IN_SERVICE') then
    raise exception using errcode = '22023', message = 'appointment cannot be canceled';
  end if;
  select coalesce(sum(case when kind in ('CAPTURE','ADJUSTMENT') then amount_cents when kind in ('REFUND','REVERSAL') then -amount_cents end),0)
    into v_paid from public.payment_transactions where organization_id = v_appointment.organization_id and appointment_id = v_appointment.id;
  if v_paid > 0 then
    raise exception using errcode = '22023', message = 'paid appointment requires manager cancellation and refund handling';
  end if;
  v_outcome := public.subscription_cancellation_outcome(v_appointment.service_period, v_appointment.cancellation_lead_minutes_snapshot);
  select nullif(trim(display_name), '') into v_actor_name from public.profiles where id = auth.uid();
  update public.appointments
     set status = 'CANCELED', version = version + 1,
         cancellation_outcome = v_outcome,
         cancellation_actor_name = coalesce(v_actor_name, 'Profissional autenticado'),
         cancelled_at = now(), cancellation_source = 'BARBER'
   where id = v_appointment.id;
  insert into public.appointment_status_events (organization_id, appointment_id, from_status, to_status, reason, actor_user_id, metadata)
  values (v_appointment.organization_id, v_appointment.id, v_appointment.status, 'CANCELED', nullif(btrim(p_reason), ''), auth.uid(), jsonb_build_object('cancellation_outcome', v_outcome, 'cancellation_actor_name', coalesce(v_actor_name, 'Profissional autenticado')));
exception when no_data_found then
  raise exception using errcode = 'P0002', message = 'appointment not found';
end;
$$;

create or replace function public.update_organization_settings(
  p_organization_id uuid,
  p_name text,
  p_slug text,
  p_public_contact_phone_e164 text default null,
  p_logo_path text default null,
  p_cancellation_lead_minutes integer default null
)
returns public.organizations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_organization public.organizations;
  v_name text := nullif(trim(p_name), '');
  v_slug text := lower(nullif(trim(p_slug), ''));
  v_phone text := nullif(trim(p_public_contact_phone_e164), '');
begin
  if not public.is_organization_owner(p_organization_id) then raise exception using errcode = '42501', message = 'organization owner required'; end if;
  if v_name is null or length(v_name) < 2 then raise exception using errcode = '22023', message = 'organization name is invalid'; end if;
  if v_slug is null or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception using errcode = '22023', message = 'organization slug is invalid'; end if;
  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception using errcode = '22023', message = 'public contact phone must be E.164'; end if;
  if p_cancellation_lead_minutes is not null and p_cancellation_lead_minutes < 0 then raise exception using errcode = '22023', message = 'cancellation lead minutes must be non-negative'; end if;
  update public.organizations
     set name = v_name, slug = v_slug, public_contact_phone_e164 = v_phone,
         logo_path = nullif(trim(p_logo_path), ''),
         cancellation_lead_minutes = coalesce(p_cancellation_lead_minutes, cancellation_lead_minutes)
   where id = p_organization_id returning * into v_organization;
  if not found then raise exception using errcode = 'P0002', message = 'organization not found'; end if;
  return v_organization;
end;
$$;

revoke all on function public.subscription_cancellation_outcome(tstzrange, integer) from public, anon, authenticated;
revoke all on function public.cancel_appointment(uuid, text, boolean) from public, anon;
grant execute on function public.cancel_appointment(uuid, text, boolean) to authenticated;
revoke all on function public.cancel_customer_subscription_session(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.cancel_customer_subscription_session(uuid, uuid, uuid, text) to authenticated;
revoke all on function public.return_subscription_session_after_staff_cancel() from public, anon, authenticated;
revoke all on function public.consume_subscription_session_after_appointment_transition() from public, anon, authenticated;
revoke all on function public.barber_cancel_appointment(uuid, text) from public, anon;
grant execute on function public.barber_cancel_appointment(uuid, text) to authenticated;
revoke all on function public.update_organization_settings(uuid, text, text, text, text) from public, anon;
revoke all on function public.update_organization_settings(uuid, text, text, text, text, integer) from public, anon;
grant execute on function public.update_organization_settings(uuid, text, text, text, text, integer) to authenticated;
