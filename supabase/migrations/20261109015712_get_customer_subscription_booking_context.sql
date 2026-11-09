create or replace function public.get_customer_subscription_booking_context(
  p_organization_id uuid,
  p_customer_id uuid,
  p_subscription_session_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plan_id uuid;
  v_plan_version_id uuid;
  v_services jsonb;
  v_barbers jsonb;
begin
  if auth.uid() is null
     or not public.is_organization_customer(p_organization_id, p_customer_id, auth.uid()) then
    raise exception using errcode = '42501', message = 'customer booking denied';
  end if;

  select subscription.plan_id, subscription.plan_version_id
    into strict v_plan_id, v_plan_version_id
    from public.customer_subscription_sessions session
    join public.customer_subscriptions subscription
      on subscription.id = session.subscription_id
     and subscription.organization_id = session.organization_id
   where session.id = p_subscription_session_id
     and session.organization_id = p_organization_id
     and session.status = 'AVAILABLE'
     and subscription.customer_id = p_customer_id
     and subscription.status = 'ACTIVE';

  if exists (
    select 1
      from public.subscription_plan_services plan_service
      left join public.services service
        on service.id = plan_service.service_id
       and service.organization_id = plan_service.organization_id
     where plan_service.organization_id = p_organization_id
       and plan_service.plan_version_id = v_plan_version_id
       and (service.id is null or not service.active)
  ) then
    raise exception using errcode = '22023', message = 'subscription plan contains inactive services';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', service.id,
    'name', plan_service.service_name_snapshot,
    'description', service.description,
    'price_cents', plan_service.list_price_cents_snapshot,
    'duration_minutes', plan_service.duration_minutes_snapshot
  ) order by plan_service.position, service.id), '[]'::jsonb)
    into v_services
    from public.subscription_plan_services plan_service
    join public.services service
      on service.id = plan_service.service_id
     and service.organization_id = plan_service.organization_id
   where plan_service.organization_id = p_organization_id
     and plan_service.plan_version_id = v_plan_version_id
     and service.active;

  if jsonb_array_length(v_services) = 0 then
    raise exception using errcode = '22023', message = 'subscription plan has no active services';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', barber.id,
    'name', barber.display_name,
    'bio', barber.bio,
    'avatar_url', barber.avatar_url,
    'service_ids', v_services_ids.ids,
    'subscription_plan_ids', jsonb_build_array(v_plan_id)
  ) order by barber.display_name), '[]'::jsonb)
    into v_barbers
    from public.barbers barber
    join public.barber_subscription_plans assignment
      on assignment.organization_id = barber.organization_id
     and assignment.barber_id = barber.id
     and assignment.plan_id = v_plan_id
     and assignment.active
    cross join lateral (
      select coalesce(jsonb_agg((service.value ->> 'id')::uuid order by service.ordinality), '[]'::jsonb) as ids
        from jsonb_array_elements(v_services) with ordinality as service(value, ordinality)
    ) v_services_ids
   where barber.organization_id = p_organization_id
     and barber.active
     and not exists (
       select 1
         from public.subscription_plan_services plan_service
         join public.services service
           on service.id = plan_service.service_id
          and service.organization_id = plan_service.organization_id
        where plan_service.organization_id = p_organization_id
          and plan_service.plan_version_id = v_plan_version_id
          and service.active
          and not exists (
            select 1
              from public.barber_services barber_service
             where barber_service.organization_id = p_organization_id
               and barber_service.barber_id = barber.id
               and barber_service.service_id = service.id
               and barber_service.active
          )
     );

  return jsonb_build_object(
    'plan_id', v_plan_id,
    'services', v_services,
    'barbers', v_barbers
  );
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'subscription session not available';
end;
$$;

revoke all on function public.get_customer_subscription_booking_context(uuid, uuid, uuid) from public, anon;
grant execute on function public.get_customer_subscription_booking_context(uuid, uuid, uuid) to authenticated;
