-- A criação da agenda dispara a outbox antes do update de payment_mode.
-- Corrige o payload pendente para o transporte WhatsApp reconhecer a sessão.
create or replace function public.mark_subscription_notification_payload()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.payment_mode = 'SUBSCRIPTION'
     and old.payment_mode is distinct from new.payment_mode then
    update public.notification_outbox
       set payload = payload || jsonb_build_object(
         'subscription_session', true,
         'payment_mode', 'SUBSCRIPTION',
         'amount_cents', 0
       )
     where organization_id = new.organization_id
       and appointment_id = new.id
       and status in ('PENDING', 'FAILED');
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_subscription_notification_payload on public.appointments;
create trigger appointments_subscription_notification_payload
after update of payment_mode on public.appointments
for each row execute function public.mark_subscription_notification_payload();

revoke all on function public.mark_subscription_notification_payload() from public, anon, authenticated;
