-- Agenda de sessão de assinatura. Reutiliza o lock/conflict path da agenda atual.

create or replace function public.book_customer_subscription_session(
  p_organization_id uuid,
  p_customer_id uuid,
  p_subscription_session_id uuid,
  p_barber_id uuid,
  p_starts_at timestamptz
)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  v_session public.customer_subscription_sessions%rowtype;
  v_sub public.customer_subscriptions%rowtype;
  v_plan public.subscription_plan_versions%rowtype;
  v_result jsonb;
  v_items jsonb;
  v_appointment_id uuid;
begin
  if not public.organization_module_enabled(p_organization_id, 'subscription_plans') then raise exception using errcode='42501', message='subscription module disabled'; end if;
  if not public.is_organization_customer(p_organization_id, p_customer_id) then raise exception using errcode='42501', message='customer booking denied'; end if;
  select * into strict v_session from public.customer_subscription_sessions where id=p_subscription_session_id and organization_id=p_organization_id for update;
  select * into strict v_sub from public.customer_subscriptions where id=v_session.subscription_id and organization_id=p_organization_id for update;
  select * into strict v_plan from public.subscription_plan_versions where id=v_sub.plan_version_id and organization_id=p_organization_id;
  if v_sub.customer_id <> p_customer_id or v_sub.status <> 'ACTIVE' or v_session.status <> 'AVAILABLE' then raise exception using errcode='22023', message='subscription session is not available'; end if;
  if p_starts_at < now() or p_starts_at > now() + interval '15 days' then raise exception using errcode='22023', message='subscription booking outside allowed window'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('service_id', service_id, 'quantity', 1) order by position), '[]'::jsonb) into v_items from public.subscription_plan_services where organization_id=p_organization_id and plan_version_id=v_plan.id;
  v_result := public.create_appointment_hold(p_organization_id,p_customer_id,p_barber_id,p_starts_at,v_items,'COUNTER',null);
  v_appointment_id := (v_result->>'appointment_id')::uuid;
  update public.appointments set payment_mode='SUBSCRIPTION',total_cents_snapshot=0,list_total_cents_snapshot=0,deposit_required_cents_snapshot=0,amount_waived_cents=0,notes=concat_ws(E'\n',notes,'Sessão assinatura') where id=v_appointment_id and organization_id=p_organization_id;
  update public.customer_subscription_sessions set status='SCHEDULED',appointment_id=v_appointment_id where id=v_session.id and organization_id=p_organization_id and status='AVAILABLE';
  if not found then raise exception using errcode='40001', message='subscription session changed while booking'; end if;
  return v_result || jsonb_build_object('subscription_session_id', v_session.id, 'session_label', 'Sessão assinatura');
end $$;

revoke all on function public.book_customer_subscription_session(uuid,uuid,uuid,uuid,timestamptz) from public, anon;
grant execute on function public.book_customer_subscription_session(uuid,uuid,uuid,uuid,timestamptz) to authenticated;
