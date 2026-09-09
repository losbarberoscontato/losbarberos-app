create or replace function public.cancel_customer_subscription_session(
  p_organization_id uuid, p_customer_id uuid, p_subscription_session_id uuid, p_reason text default 'Cancelada pelo cliente'
)
returns public.customer_subscription_sessions
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare v_session public.customer_subscription_sessions%rowtype; v_appointment public.appointments%rowtype; v_return boolean; v_status public.subscription_session_status;
begin
  if not public.is_organization_customer(p_organization_id,p_customer_id) then raise exception using errcode='42501', message='session cancellation denied'; end if;
  select * into strict v_session from public.customer_subscription_sessions where id=p_subscription_session_id and organization_id=p_organization_id for update;
  select * into strict v_appointment from public.appointments where id=v_session.appointment_id and organization_id=p_organization_id for update;
  select lower(v_appointment.service_period) - make_interval(mins => v_appointment.cancellation_lead_minutes_snapshot) >= now() into v_return;
  perform public.cancel_appointment(v_appointment.id, left(coalesce(p_reason,'Cancelada pelo cliente'),500), true);
  v_status := case when v_return then 'AVAILABLE' else 'CONSUMED' end;
  update public.customer_subscription_sessions set status=v_status, canceled_at=now(), consumed_at=case when v_return then null else now() end where id=v_session.id and organization_id=p_organization_id;
  update public.notification_outbox set payload = payload || jsonb_build_object('subscription_session', true, 'subscription_session_status', v_status::text, 'session_returned', v_return) where organization_id=p_organization_id and appointment_id=v_appointment.id and template_key='appointment_canceled' and status in ('PENDING','FAILED');
  return (select s from public.customer_subscription_sessions s where s.id=v_session.id and s.organization_id=p_organization_id);
end $$;
