-- Mantém o vínculo bidirecional entre a sessão de assinatura e o agendamento.
-- O fluxo antigo preenchia apenas customer_subscription_sessions.appointment_id,
-- enquanto os triggers consultavam appointments.subscription_session_id.
create or replace function public.sync_subscription_session_appointment_link()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.appointment_id is not null then
      update public.appointments
         set subscription_session_id = new.id
       where id = new.appointment_id
         and organization_id = new.organization_id;
    end if;
  elsif old.appointment_id is distinct from new.appointment_id then
    update public.appointments
       set subscription_session_id = null
     where organization_id = new.organization_id
       and subscription_session_id = new.id
       and id is distinct from new.appointment_id;

    if new.appointment_id is not null then
      update public.appointments
         set subscription_session_id = new.id
       where id = new.appointment_id
         and organization_id = new.organization_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists customer_subscription_sessions_sync_appointment_link
  on public.customer_subscription_sessions;
create trigger customer_subscription_sessions_sync_appointment_link
after insert or update of appointment_id on public.customer_subscription_sessions
for each row
execute function public.sync_subscription_session_appointment_link();

-- Corrige os agendamentos já criados antes da sincronização.
update public.appointments a
   set subscription_session_id = s.id
  from public.customer_subscription_sessions s
 where s.appointment_id = a.id
   and s.organization_id = a.organization_id
   and a.subscription_session_id is distinct from s.id;

create or replace function public.return_subscription_session_after_staff_cancel()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session_id uuid := new.subscription_session_id;
begin
  if new.status = 'CANCELED' and old.status is distinct from new.status then
    if v_session_id is null then
      select id into v_session_id
        from public.customer_subscription_sessions
       where organization_id = new.organization_id
         and appointment_id = new.id
       limit 1;
    end if;

    if v_session_id is not null then
      update public.customer_subscription_sessions
         set status = (case when coalesce(new.cancellation_outcome, 'AFTER_DEADLINE') = 'ON_TIME' then 'AVAILABLE' else 'CANCELED' end)::public.subscription_session_status,
             appointment_id = null,
             canceled_at = coalesce(new.cancelled_at, now()),
             consumed_at = case when coalesce(new.cancellation_outcome, 'AFTER_DEADLINE') = 'ON_TIME' then null else coalesce(new.cancelled_at, now()) end
       where id = v_session_id
         and organization_id = new.organization_id
         and status = 'SCHEDULED';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_subscription_staff_cancel on public.appointments;
create trigger appointments_subscription_staff_cancel
after update of status on public.appointments
for each row when (new.status = 'CANCELED' and old.status is distinct from new.status)
execute function public.return_subscription_session_after_staff_cancel();

create or replace function public.consume_subscription_session_after_appointment_transition()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_session_id uuid := new.subscription_session_id;
  v_actor_name text;
begin
  if new.status in ('COMPLETED', 'NO_SHOW') and old.status is distinct from new.status then
    if v_session_id is null then
      select id into v_session_id
        from public.customer_subscription_sessions
       where organization_id = new.organization_id
         and appointment_id = new.id
       limit 1;
    end if;

    if new.status = 'NO_SHOW' then
      select nullif(trim(display_name), '') into v_actor_name
        from public.profiles where id = auth.uid();
      update public.appointments
         set cancellation_outcome = 'AFTER_DEADLINE',
             cancellation_actor_name = coalesce(v_actor_name, 'Usuário autenticado'),
             cancelled_at = coalesce(cancelled_at, now()),
             cancellation_source = coalesce(cancellation_source, 'MANAGER')
       where id = new.id and organization_id = new.organization_id;
    end if;

    if v_session_id is not null then
      update public.customer_subscription_sessions
         set status = (case when new.status = 'COMPLETED' then 'COMPLETED' else 'CANCELED' end)::public.subscription_session_status,
             consumed_at = coalesce(consumed_at, now()),
             canceled_at = case when new.status = 'NO_SHOW' then coalesce(canceled_at, now()) else canceled_at end
       where id = v_session_id
         and organization_id = new.organization_id
         and status = 'SCHEDULED';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_subscription_session_completion on public.appointments;
create trigger appointments_subscription_session_completion
after update of status on public.appointments
for each row
execute function public.consume_subscription_session_after_appointment_transition();

-- Reconcilia cancelamentos já efetuados antes do trigger corrigido.
update public.customer_subscription_sessions s
   set status = (case when coalesce(a.cancellation_outcome, 'AFTER_DEADLINE') = 'ON_TIME' then 'AVAILABLE' else 'CANCELED' end)::public.subscription_session_status,
       appointment_id = null,
       canceled_at = coalesce(a.cancelled_at, now()),
       consumed_at = case when coalesce(a.cancellation_outcome, 'AFTER_DEADLINE') = 'ON_TIME' then null else coalesce(a.cancelled_at, now()) end
  from public.appointments a
 where s.organization_id = a.organization_id
   and s.appointment_id = a.id
   and s.status = 'SCHEDULED'
   and a.status = 'CANCELED';

revoke all on function public.sync_subscription_session_appointment_link() from public, anon, authenticated;
revoke all on function public.return_subscription_session_after_staff_cancel() from public, anon, authenticated;
revoke all on function public.consume_subscription_session_after_appointment_transition() from public, anon, authenticated;
