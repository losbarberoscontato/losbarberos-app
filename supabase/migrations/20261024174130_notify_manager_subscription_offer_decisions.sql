-- Notifica o gestor quando uma proposta de assinatura é aceita ou recusada.
-- A transição de status é a fonte de verdade para ambos os fluxos e evita
-- depender de qual tela/RPC do cliente concluiu a decisão.
alter table public.manager_notifications
  drop constraint if exists manager_notifications_kind_check;

alter table public.manager_notifications
  add constraint manager_notifications_kind_check
  check (kind in (
    'SUBSCRIPTION_REQUEST',
    'SUBSCRIPTION_OFFER_ACCEPTED',
    'SUBSCRIPTION_OFFER_DECLINED',
    'PROJECT_OFFER_DECLINED',
    'SUBSCRIPTION_CANCELLATION_REQUEST',
    'PROJECT_CANCELLATION_REQUEST'
  ));

create or replace function public.notify_manager_subscription_offer_decision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_customer_name text;
  v_plan_name text;
  v_kind text;
  v_title text;
  v_verb text;
  v_owner uuid;
begin
  if old.status::text <> 'REQUESTED'
     or old.contract_accepted_at is not null
     or new.status::text not in ('ACTIVE', 'DECLINED') then
    return new;
  end if;

  if new.status::text = 'ACTIVE' and new.contract_accepted_at is null then
    return new;
  end if;

  select c.full_name, p.name
    into v_customer_name, v_plan_name
    from public.customers c
    join public.subscription_plans p
      on p.id = new.plan_id and p.organization_id = new.organization_id
   where c.id = new.customer_id and c.organization_id = new.organization_id;

  if v_customer_name is null then
    return new;
  end if;

  if new.status::text = 'ACTIVE' then
    v_kind := 'SUBSCRIPTION_OFFER_ACCEPTED';
    v_title := 'Plano aceito pelo cliente';
    v_verb := 'aceitou';
  else
    v_kind := 'SUBSCRIPTION_OFFER_DECLINED';
    v_title := 'Plano recusado pelo cliente';
    v_verb := 'recusou';
  end if;

  for v_owner in
    select m.user_id
      from public.organization_memberships m
     where m.organization_id = new.organization_id
       and m.active
       and m.role = 'OWNER'
  loop
    insert into public.manager_notifications(
      organization_id, recipient_user_id, customer_id, subscription_id,
      kind, title, body, href
    ) values (
      new.organization_id,
      v_owner,
      new.customer_id,
      new.id,
      v_kind,
      v_title,
      v_customer_name || ' ' || v_verb || ' o plano ' || coalesce(v_plan_name, 'de assinatura') || '.',
      '/gestor/clientes?cliente=' || new.customer_id::text || '&aba=agendamentos'
    )
    on conflict do nothing;
  end loop;

  return new;
end;
$$;

revoke all on function public.notify_manager_subscription_offer_decision() from public, anon, authenticated;

drop trigger if exists customer_subscription_offer_decision_notification on public.customer_subscriptions;
create trigger customer_subscription_offer_decision_notification
  after update of status, contract_accepted_at on public.customer_subscriptions
  for each row
  when (old.status::text = 'REQUESTED' and new.status::text in ('ACTIVE', 'DECLINED'))
  execute function public.notify_manager_subscription_offer_decision();
