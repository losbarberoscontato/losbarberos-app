-- Limita assinaturas em andamento por cliente com serialização por cliente.
drop index if exists public.customer_subscriptions_one_active_per_customer;

create or replace function public.enforce_customer_subscription_limit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_old_lock bigint;
  v_new_lock bigint;
  v_active_count integer;
begin
  if tg_op = 'UPDATE'
     and old.organization_id = new.organization_id
     and old.customer_id = new.customer_id
     and old.status = new.status then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_old_lock := hashtextextended(old.organization_id::text || ':' || old.customer_id::text, 0);
  end if;
  v_new_lock := hashtextextended(new.organization_id::text || ':' || new.customer_id::text, 0);

  if v_old_lock is not null and v_old_lock < v_new_lock then
    perform pg_advisory_xact_lock(v_old_lock);
    perform pg_advisory_xact_lock(v_new_lock);
  elsif v_old_lock is not null and v_old_lock > v_new_lock then
    perform pg_advisory_xact_lock(v_new_lock);
    perform pg_advisory_xact_lock(v_old_lock);
  else
    perform pg_advisory_xact_lock(v_new_lock);
  end if;

  if new.status in ('REQUESTED', 'PENDING_PAYMENT', 'ACTIVE') then
    select count(*) into v_active_count
      from public.customer_subscriptions subscription
     where subscription.organization_id = new.organization_id
       and subscription.customer_id = new.customer_id
       and subscription.status in ('REQUESTED', 'PENDING_PAYMENT', 'ACTIVE')
       and subscription.id <> new.id;
    if v_active_count >= 5 then
      raise exception using errcode = '23514', message = 'customer subscription limit reached (5)';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists customer_subscriptions_limit on public.customer_subscriptions;
create trigger customer_subscriptions_limit
before insert or update of status, customer_id, organization_id
on public.customer_subscriptions
for each row execute function public.enforce_customer_subscription_limit();

-- Eventos permanecem auditáveis depois da exclusão da oferta pendente.
alter table public.subscription_events
  alter column subscription_id drop not null;
alter table public.subscription_events
  drop constraint if exists subscription_events_subscription_id_organization_id_fkey;
alter table public.subscription_events
  add constraint subscription_events_subscription_id_organization_id_fkey
  foreign key (subscription_id, organization_id)
  references public.customer_subscriptions(id, organization_id)
  on delete set null (subscription_id);

create or replace function public.delete_pending_customer_subscription_offer(
  p_organization_id uuid,
  p_subscription_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_subscription public.customer_subscriptions%rowtype;
begin
  if auth.uid() is null or not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'subscription offer deletion denied';
  end if;

  select * into strict v_subscription
    from public.customer_subscriptions
   where id = p_subscription_id and organization_id = p_organization_id
   for update;

  if v_subscription.status <> 'REQUESTED'
     or v_subscription.contract_accepted_at is not null then
    raise exception using errcode = '22023', message = 'subscription offer is not awaiting customer decision';
  end if;

  delete from public.customer_subscriptions
   where id = v_subscription.id and organization_id = p_organization_id;
end;
$$;

revoke all on function public.enforce_customer_subscription_limit() from public, anon, authenticated;
revoke all on function public.delete_pending_customer_subscription_offer(uuid, uuid) from public, anon;
grant execute on function public.delete_pending_customer_subscription_offer(uuid, uuid) to authenticated;
