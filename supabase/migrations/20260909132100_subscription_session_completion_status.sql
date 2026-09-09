-- Corrige o estado final: serviço concluído fica COMPLETED; no-show consome a sessão.
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
       set status = case when new.status = 'COMPLETED' then 'COMPLETED' else 'CONSUMED' end,
           consumed_at = coalesce(consumed_at, now())
     where id = new.subscription_session_id
       and organization_id = new.organization_id
       and status = 'SCHEDULED';
  end if;
  return new;
end;
$$;

revoke all on function public.consume_subscription_session_after_appointment_transition() from public, anon, authenticated;
