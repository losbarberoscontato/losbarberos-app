update public.manager_notifications n set href='/gestor/clientes?cliente=' || n.customer_id::text || '&aba=assinaturas'
where n.kind='SUBSCRIPTION_REQUEST' and n.customer_id is not null and n.subscription_id is not null;

create or replace function public.set_subscription_notification_plan_name()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_name text;
begin
  if new.subscription_id is not null then
    select p.name into v_name from public.customer_subscriptions s
      join public.subscription_plans p on p.id=s.plan_id and p.organization_id=s.organization_id
     where s.id=new.subscription_id and s.organization_id=new.organization_id;
    if v_name is not null and new.kind='SUBSCRIPTION_REQUEST' then new.body := split_part(new.body, ' Plano: ', 1) || ' Plano: ' || v_name || '.'; end if;
    if new.kind='SUBSCRIPTION_REQUEST' and new.customer_id is not null then
      new.href := '/gestor/clientes?cliente=' || new.customer_id::text || '&aba=assinaturas';
    end if;
  end if;
  return new;
end $$;
