-- No-show de sessão de assinatura também mantém o ator e o horário do cancelamento.
create or replace function public.consume_subscription_session_after_appointment_transition()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor_name text;
begin
  if new.subscription_session_id is not null
     and new.status in ('COMPLETED', 'NO_SHOW')
     and old.status is distinct from new.status then
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

revoke all on function public.consume_subscription_session_after_appointment_transition() from public, anon, authenticated;
