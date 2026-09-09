create or replace function public.return_subscription_session_after_staff_cancel()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if new.status='CANCELED' and new.subscription_session_id is not null then
    update public.customer_subscription_sessions
      set status='AVAILABLE', appointment_id=null, canceled_at=now(), consumed_at=null
      where id=new.subscription_session_id and organization_id=new.organization_id and status='SCHEDULED';
  end if;
  return new;
end $$;

drop trigger if exists appointments_subscription_staff_cancel on public.appointments;
create trigger appointments_subscription_staff_cancel
  after update of status on public.appointments
  for each row when (new.status='CANCELED' and old.status is distinct from new.status)
  execute function public.return_subscription_session_after_staff_cancel();
