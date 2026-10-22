create or replace function public.decline_customer_subscription_offer(
  p_organization_id uuid,
  p_subscription_id uuid
)
returns public.customer_subscriptions
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_sub public.customer_subscriptions;
  v_customer public.customers;
  v_plan public.subscription_plans;
  v_owner uuid;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authenticated client required';
  end if;
  select * into strict v_sub
    from public.customer_subscriptions
   where id = p_subscription_id and organization_id = p_organization_id
   for update;

  if not public.is_organization_customer(p_organization_id, v_sub.customer_id) then
    raise exception using errcode = '42501', message = 'subscription offer decline denied';
  end if;
  if v_sub.status::text <> 'REQUESTED' or v_sub.contract_accepted_at is not null
     or v_sub.created_by is null or v_sub.created_by = auth.uid()
     or not exists (
       select 1 from public.organization_memberships m
        where m.organization_id = p_organization_id and m.user_id = v_sub.created_by
          and m.active and m.role = 'OWNER'
     ) then
    raise exception using errcode = '22023', message = 'subscription offer is not awaiting customer decision';
  end if;

  update public.customer_subscriptions
     set status = 'DECLINED', declined_at = now(), declined_by = auth.uid(), updated_at = now()
   where id = v_sub.id
   returning * into v_sub;

  insert into public.subscription_events(organization_id, subscription_id, event_type, actor_user_id, idempotency_key, metadata)
  values (p_organization_id, v_sub.id, 'DECLINED', auth.uid(), 'declined-client:' || v_sub.id,
          jsonb_build_object('source', 'CLIENT_APP'))
  on conflict (organization_id, idempotency_key) do nothing;

  update public.customer_in_app_notifications
     set read_at = coalesce(read_at, now())
   where organization_id = p_organization_id and customer_id = v_sub.customer_id
     and subscription_id = v_sub.id;

  select * into v_customer from public.customers where id = v_sub.customer_id and organization_id = p_organization_id;
  select * into v_plan from public.subscription_plans where id = v_sub.plan_id and organization_id = p_organization_id;
  for v_owner in
    select m.user_id from public.organization_memberships m
     where m.organization_id = p_organization_id and m.active and m.role = 'OWNER'
  loop
    insert into public.manager_notifications(organization_id, recipient_user_id, customer_id, subscription_id, kind, title, body, href)
    values (p_organization_id, v_owner, v_sub.customer_id, v_sub.id, 'SUBSCRIPTION_OFFER_DECLINED',
            'Plano recusado pelo cliente', v_customer.full_name || ' recusou o plano ' || v_plan.name || '.',
            '/gestor/clientes?cliente=' || v_sub.customer_id::text || '&aba=assinaturas')
    on conflict do nothing;
  end loop;
  return v_sub;
end;
$$;

revoke all on function public.decline_customer_subscription_offer(uuid, uuid) from public, anon;
grant execute on function public.decline_customer_subscription_offer(uuid, uuid) to authenticated;

create or replace function public.decline_customer_project_engagement(
  p_organization_id uuid,
  p_engagement_id uuid
)
returns public.project_engagements
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_engagement public.project_engagements;
  v_customer public.customers;
  v_project public.projects;
  v_package public.project_packages;
  v_owner uuid;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authenticated client required';
  end if;
  select * into strict v_engagement
    from public.project_engagements
   where id = p_engagement_id and organization_id = p_organization_id
   for update;

  if not public.is_organization_customer(p_organization_id, v_engagement.customer_id) then
    raise exception using errcode = '42501', message = 'project offer decline denied';
  end if;
  if v_engagement.status <> 'PROPOSAL' or v_engagement.created_by = auth.uid()
     or not exists (
       select 1 from public.organization_memberships m
        where m.organization_id = p_organization_id and m.user_id = v_engagement.created_by
          and m.active and m.role = 'OWNER'
     ) then
    raise exception using errcode = '22023', message = 'project offer is not awaiting customer decision';
  end if;

  update public.project_engagements
     set status = 'DECLINED', declined_at = now(), declined_by = auth.uid(), updated_at = now()
   where id = v_engagement.id
   returning * into v_engagement;

  update public.customer_in_app_notifications
     set read_at = coalesce(read_at, now())
   where organization_id = p_organization_id and customer_id = v_engagement.customer_id
     and engagement_id = v_engagement.id;

  select * into v_customer from public.customers where id = v_engagement.customer_id and organization_id = p_organization_id;
  select * into v_project from public.projects where id = v_engagement.project_id and organization_id = p_organization_id;
  select * into v_package from public.project_packages where id = v_engagement.package_id and organization_id = p_organization_id;
  for v_owner in
    select m.user_id from public.organization_memberships m
     where m.organization_id = p_organization_id and m.active and m.role = 'OWNER'
  loop
    insert into public.manager_notifications(organization_id, recipient_user_id, customer_id, engagement_id, kind, title, body, href)
    values (p_organization_id, v_owner, v_engagement.customer_id, v_engagement.id, 'PROJECT_OFFER_DECLINED',
            'Plano recusado pelo cliente', v_customer.full_name || ' recusou ' || v_project.name || ' · ' || v_package.name || '.',
            '/gestor/projetos/' || v_project.id::text)
    on conflict do nothing;
  end loop;
  return v_engagement;
end;
$$;

revoke all on function public.decline_customer_project_engagement(uuid, uuid) from public, anon;
grant execute on function public.decline_customer_project_engagement(uuid, uuid) to authenticated;
