-- Avisos persistentes para ofertas comerciais aguardando ciência do cliente.
create table public.customer_in_app_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null,
  kind text not null check (kind in ('SUBSCRIPTION_OFFER', 'PROJECT_OFFER')),
  subscription_id uuid references public.customer_subscriptions(id) on delete cascade,
  engagement_id uuid references public.project_engagements(id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (customer_id, organization_id) references public.customers(id, organization_id) on delete cascade,
  check ((kind = 'SUBSCRIPTION_OFFER' and subscription_id is not null and engagement_id is null) or
         (kind = 'PROJECT_OFFER' and engagement_id is not null and subscription_id is null))
);
create unique index customer_in_app_notifications_offer_unique
  on public.customer_in_app_notifications (organization_id, customer_id, kind, coalesce(subscription_id, engagement_id));
create index customer_in_app_notifications_unread_idx
  on public.customer_in_app_notifications (organization_id, customer_id, created_at desc) where read_at is null;
alter table public.customer_in_app_notifications enable row level security;
alter table public.customer_in_app_notifications force row level security;
create policy customer_notifications_select_own on public.customer_in_app_notifications
  for select to authenticated using (public.is_organization_customer(organization_id, customer_id));
create policy customer_notifications_update_own on public.customer_in_app_notifications
  for update to authenticated using (public.is_organization_customer(organization_id, customer_id))
  with check (public.is_organization_customer(organization_id, customer_id));
grant select, update on public.customer_in_app_notifications to authenticated;

create or replace function public.notify_customer_of_subscription_offer()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'REQUESTED' and new.contract_accepted_at is null
     and public.is_organization_owner(new.organization_id) then
    insert into public.customer_in_app_notifications(organization_id, customer_id, kind, subscription_id)
    values (new.organization_id, new.customer_id, 'SUBSCRIPTION_OFFER', new.id)
    on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists customer_subscription_offer_notification on public.customer_subscriptions;
create trigger customer_subscription_offer_notification
  after insert on public.customer_subscriptions
  for each row execute function public.notify_customer_of_subscription_offer();

create or replace function public.accept_customer_subscription_offer(p_organization_id uuid, p_subscription_id uuid)
returns public.customer_subscriptions language plpgsql security definer set search_path = public, pg_temp as $$
declare v_sub public.customer_subscriptions;
begin
  select * into strict v_sub from public.customer_subscriptions
   where id = p_subscription_id and organization_id = p_organization_id for update;
  if not public.is_organization_customer(p_organization_id, v_sub.customer_id) then
    raise exception using errcode='42501', message='subscription offer acceptance denied';
  end if;
  if v_sub.status <> 'REQUESTED' or v_sub.contract_accepted_at is not null then
    raise exception using errcode='22023', message='subscription offer is not awaiting acceptance';
  end if;
  update public.customer_subscriptions set contract_accepted_at = now(), contract_accepted_by = auth.uid(), updated_at = now()
   where id = v_sub.id returning * into v_sub;
  insert into public.subscription_contract_acceptances(organization_id, subscription_id, contract_version, accepted_by, acceptance_source)
  values (p_organization_id, v_sub.id, v_sub.contract_version, auth.uid(), 'CLIENT_OFFER')
  on conflict do nothing;
  update public.customer_in_app_notifications set read_at = coalesce(read_at, now())
   where organization_id = p_organization_id and customer_id = v_sub.customer_id and subscription_id = v_sub.id;
  return v_sub;
end $$;
revoke all on function public.accept_customer_subscription_offer(uuid, uuid) from public, anon;
grant execute on function public.accept_customer_subscription_offer(uuid, uuid) to authenticated;

create or replace function public.request_customer_project_engagement(p_organization_id uuid, p_project_id uuid, p_package_id uuid)
returns public.project_engagements language plpgsql security definer set search_path = public, pg_temp as $$
declare v_customer_id uuid; v_engagement public.project_engagements; v_project public.projects; v_package public.project_packages;
begin
  select c.id into strict v_customer_id from public.customers c
   where c.organization_id = p_organization_id and public.is_organization_customer(c.organization_id, c.id) and c.active limit 1;
  if not public.organization_module_enabled(p_organization_id, 'projects') then
    raise exception using errcode='42501', message='projects module disabled';
  end if;
  select * into strict v_project from public.projects where id=p_project_id and organization_id=p_organization_id and status='PUBLISHED';
  select * into strict v_package from public.project_packages where id=p_package_id and organization_id=p_organization_id and project_id=p_project_id and active;
  if exists (select 1 from public.project_engagements where organization_id=p_organization_id and customer_id=v_customer_id and project_id=p_project_id and status in ('PROPOSAL','ACTIVE')) then
    raise exception using errcode='23505', message='customer already has a project request';
  end if;
  insert into public.project_engagements(organization_id,project_id,customer_id,package_id,status,contracted_cents,proposal_sent_at,created_by)
  values(p_organization_id,p_project_id,v_customer_id,p_package_id,'PROPOSAL',v_package.price_cents,now(),auth.uid()) returning * into v_engagement;
  return v_engagement;
end $$;

create or replace function public.accept_customer_project_engagement(p_organization_id uuid, p_engagement_id uuid)
returns public.project_engagements language plpgsql security definer set search_path = public, pg_temp as $$
declare v_engagement public.project_engagements;
begin
  select * into strict v_engagement from public.project_engagements where id=p_engagement_id and organization_id=p_organization_id for update;
  if not public.is_organization_customer(p_organization_id, v_engagement.customer_id) then
    raise exception using errcode='42501', message='project offer acceptance denied';
  end if;
  if v_engagement.status <> 'PROPOSAL' then raise exception using errcode='22023', message='project offer is not awaiting acceptance'; end if;
  update public.project_engagements set status='ACTIVE',accepted_at=now(),acceptance_version='v1',updated_at=now()
   where id=v_engagement.id returning * into v_engagement;
  insert into public.project_contract_acceptances(organization_id,engagement_id,customer_id,contract_version,accepted_by,metadata)
  values(p_organization_id,v_engagement.id,v_engagement.customer_id,'v1',auth.uid(),jsonb_build_object('source','CLIENT_APP'))
  on conflict (engagement_id,contract_version) do nothing;
  update public.customer_in_app_notifications set read_at=coalesce(read_at,now())
   where organization_id=p_organization_id and customer_id=v_engagement.customer_id and engagement_id=v_engagement.id;
  return v_engagement;
end $$;
revoke all on function public.request_customer_project_engagement(uuid, uuid, uuid), public.accept_customer_project_engagement(uuid, uuid) from public, anon;
grant execute on function public.request_customer_project_engagement(uuid, uuid, uuid), public.accept_customer_project_engagement(uuid, uuid) to authenticated;

create or replace function public.notify_manager_of_project_request()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_customer public.customers; v_project public.projects; v_owner uuid;
begin
  if new.status <> 'PROPOSAL' or not public.is_organization_customer(new.organization_id,new.customer_id) then return new; end if;
  select * into v_customer from public.customers where id=new.customer_id and organization_id=new.organization_id;
  select * into v_project from public.projects where id=new.project_id and organization_id=new.organization_id;
  for v_owner in select user_id from public.organization_memberships where organization_id=new.organization_id and active and role='OWNER' loop
    insert into public.manager_notifications(organization_id,recipient_user_id,customer_id,kind,title,body,href)
    values(new.organization_id,v_owner,new.customer_id,'SUBSCRIPTION_REQUEST','Nova solicitação de projeto',v_customer.full_name || ' solicitou ' || v_project.name || '.', '/gestor/projetos')
    on conflict do nothing;
  end loop;
  return new;
end $$;
drop trigger if exists project_request_manager_notification on public.project_engagements;
create trigger project_request_manager_notification after insert on public.project_engagements
for each row execute function public.notify_manager_of_project_request();

create policy published_projects_customer_select on public.projects
  for select to authenticated using (status='PUBLISHED' and exists (select 1 from public.customers c where c.organization_id=projects.organization_id and public.is_organization_customer(c.organization_id,c.id)));
create policy active_project_packages_customer_select on public.project_packages
  for select to authenticated using (active and exists (select 1 from public.projects p where p.id=project_packages.project_id and p.organization_id=project_packages.organization_id and p.status='PUBLISHED'));

create or replace function public.notify_customer_of_project_offer()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status='PROPOSAL' and public.is_organization_owner(new.organization_id) then
    insert into public.customer_in_app_notifications(organization_id,customer_id,kind,engagement_id)
    values(new.organization_id,new.customer_id,'PROJECT_OFFER',new.id) on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists customer_project_offer_notification on public.project_engagements;
create trigger customer_project_offer_notification after insert on public.project_engagements
for each row execute function public.notify_customer_of_project_offer();

create or replace function public.set_subscription_notification_plan_name()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_name text;
begin
  if new.subscription_id is not null then
    select p.name into v_name from public.customer_subscriptions s
      join public.subscription_plans p on p.id=s.plan_id and p.organization_id=s.organization_id
     where s.id=new.subscription_id and s.organization_id=new.organization_id;
    if v_name is not null and new.kind='SUBSCRIPTION_REQUEST' then new.body := new.body || ' Plano: ' || v_name || '.'; end if;
    if new.kind='SUBSCRIPTION_REQUEST' and new.customer_id is not null then
      new.href := '/gestor/clientes?cliente=' || new.customer_id::text || '&assinatura=' || new.subscription_id::text;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists manager_notification_subscription_plan_name on public.manager_notifications;
create trigger manager_notification_subscription_plan_name before insert on public.manager_notifications
for each row execute function public.set_subscription_notification_plan_name();
