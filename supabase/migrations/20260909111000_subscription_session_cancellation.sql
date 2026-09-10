create or replace function public.cancel_customer_subscription_session(
  p_organization_id uuid,
  p_customer_id uuid,
  p_subscription_session_id uuid,
  p_reason text default 'Cancelada pelo cliente'
)
returns public.customer_subscription_sessions
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare v_session public.customer_subscription_sessions%rowtype; v_appointment public.appointments%rowtype; v_return boolean;
begin
  if not public.is_organization_customer(p_organization_id,p_customer_id) then raise exception using errcode='42501', message='session cancellation denied'; end if;
  select * into strict v_session from public.customer_subscription_sessions where id=p_subscription_session_id and organization_id=p_organization_id for update;
  select * into strict v_appointment from public.appointments where id=v_session.appointment_id and organization_id=p_organization_id for update;
  select lower(v_appointment.service_period) - make_interval(mins => v_appointment.cancellation_lead_minutes_snapshot) >= now() into v_return;
  perform public.cancel_appointment(v_appointment.id, left(coalesce(p_reason,'Cancelada pelo cliente'),500), true);
  update public.customer_subscription_sessions set status=case when v_return then 'AVAILABLE' else 'CONSUMED' end, canceled_at=now(), consumed_at=case when v_return then null else now() end where id=v_session.id and organization_id=p_organization_id;
  return (select s from public.customer_subscription_sessions s where s.id=v_session.id and s.organization_id=p_organization_id);
end $$;

revoke all on function public.cancel_customer_subscription_session(uuid,uuid,uuid,text) from public, anon;
grant execute on function public.cancel_customer_subscription_session(uuid,uuid,uuid,text) to authenticated;
