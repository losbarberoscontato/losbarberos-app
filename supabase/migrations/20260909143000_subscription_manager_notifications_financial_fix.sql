-- Solicitações de assinatura precisam aparecer no sino do gestor.
create table if not exists public.manager_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  subscription_id uuid references public.customer_subscriptions(id) on delete cascade,
  kind text not null check (kind in ('SUBSCRIPTION_REQUEST')),
  title text not null check (char_length(btrim(title)) between 2 and 160),
  body text not null check (char_length(btrim(body)) between 2 and 500),
  href text not null check (href like '/gestor/%'),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, recipient_user_id, kind, subscription_id)
);

create index if not exists manager_notifications_recipient_idx
  on public.manager_notifications (recipient_user_id, organization_id, created_at desc);

alter table public.manager_notifications enable row level security;
alter table public.manager_notifications force row level security;

drop policy if exists manager_notifications_owner_select on public.manager_notifications;
create policy manager_notifications_owner_select on public.manager_notifications
  for select to authenticated
  using (recipient_user_id = auth.uid() and public.is_organization_owner(organization_id));

drop policy if exists manager_notifications_owner_update on public.manager_notifications;
create policy manager_notifications_owner_update on public.manager_notifications
  for update to authenticated
  using (recipient_user_id = auth.uid() and public.is_organization_owner(organization_id))
  with check (recipient_user_id = auth.uid() and public.is_organization_owner(organization_id));

grant select, update on public.manager_notifications to authenticated;

create or replace function public.request_customer_subscription(
  p_organization_id uuid, p_customer_id uuid, p_plan_id uuid,
  p_acceptance_source text default 'CLIENT', p_accept_contract boolean default false
)
returns public.customer_subscriptions
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_plan public.subscription_plan_versions;
  v_sub public.customer_subscriptions;
  v_customer public.customers;
  v_owner uuid;
begin
  if not public.organization_module_enabled(p_organization_id, 'subscription_plans') then
    raise exception using errcode='42501', message='subscription module disabled';
  end if;
  if not (public.is_organization_owner(p_organization_id) or public.is_organization_customer(p_organization_id,p_customer_id)) then
    raise exception using errcode='42501', message='subscription request denied';
  end if;
  select v.* into strict v_plan
    from public.subscription_plan_versions v
   where v.organization_id=p_organization_id and v.plan_id=p_plan_id
   order by v.version desc limit 1;
  if exists (
    select 1 from public.customer_subscriptions
     where organization_id=p_organization_id and customer_id=p_customer_id and plan_id=p_plan_id
       and status in ('REQUESTED','PENDING_PAYMENT','ACTIVE')
  ) then
    raise exception using errcode='23505', message='customer already has this plan';
  end if;
  select c.* into strict v_customer from public.customers c
   where c.id=p_customer_id and c.organization_id=p_organization_id;
  insert into public.customer_subscriptions(
    organization_id,customer_id,plan_id,plan_version_id,status,payment_method,upfront_payment,
    contract_version,contract_accepted_at,contract_accepted_by,created_by
  ) values (
    p_organization_id,p_customer_id,p_plan_id,v_plan.id,'REQUESTED',v_plan.payment_method,
    v_plan.payment_method='UPFRONT',v_plan.contract_version,
    case when p_accept_contract then now() end,
    case when p_accept_contract then auth.uid() end,auth.uid()
  ) returning * into v_sub;
  insert into public.subscription_events(
    organization_id,subscription_id,event_type,actor_user_id,idempotency_key,metadata
  ) values (
    p_organization_id,v_sub.id,'REQUESTED',auth.uid(),'requested:'||v_sub.id,
    jsonb_build_object('acceptance_source',p_acceptance_source)
  );
  if p_accept_contract then
    insert into public.subscription_contract_acceptances(
      organization_id,subscription_id,contract_version,accepted_by,acceptance_source
    ) values (p_organization_id,v_sub.id,v_plan.contract_version,auth.uid(),p_acceptance_source);
  end if;
  if p_acceptance_source = 'CLIENT' then
    for v_owner in
      select m.user_id from public.organization_memberships m
       where m.organization_id=p_organization_id and m.active and m.role='OWNER'
    loop
      insert into public.manager_notifications(
        organization_id,recipient_user_id,customer_id,subscription_id,kind,title,body,href
      ) values (
        p_organization_id,v_owner,p_customer_id,v_sub.id,'SUBSCRIPTION_REQUEST',
        'Nova solicitação de assinatura',
        v_customer.full_name || ' solicitou o plano de assinatura.',
        '/gestor/clientes?cliente=' || p_customer_id::text
      ) on conflict do nothing;
    end loop;
  end if;
  return v_sub;
end $$;

revoke all on function public.request_customer_subscription(uuid,uuid,uuid,text,boolean) from public, anon;
grant execute on function public.request_customer_subscription(uuid,uuid,uuid,text,boolean) to authenticated;

-- A regra de fonte foi ampliada para SUBSCRIPTION na migration da V1.
-- O check antigo sem essa opção permanecia ativo e bloqueava o registro da parcela.
alter table public.financial_entries drop constraint if exists financial_entries_check2;
