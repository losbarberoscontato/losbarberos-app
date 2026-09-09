-- Contrato configurável por plano; adesões preservam snapshot imutável.
alter table public.subscription_plans
  add column if not exists contract_body_override text
  check (contract_body_override is null or char_length(btrim(contract_body_override)) >= 20);

alter table public.customer_subscriptions
  add column if not exists contract_body_snapshot text
  check (char_length(btrim(contract_body_snapshot)) >= 20);

create or replace function public.snapshot_subscription_contract()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.contract_body_snapshot is null then
    select coalesce(p.contract_body_override, cv.body)
      into new.contract_body_snapshot
      from public.subscription_plans p
      join public.subscription_contract_versions cv on cv.version = new.contract_version
     where p.id = new.plan_id
       and p.organization_id = new.organization_id;
  end if;
  return new;
end;
$$;

drop trigger if exists customer_subscriptions_contract_snapshot on public.customer_subscriptions;
create trigger customer_subscriptions_contract_snapshot
before insert on public.customer_subscriptions
for each row execute function public.snapshot_subscription_contract();

create or replace function public.set_subscription_plan_contract(
  p_organization_id uuid,
  p_plan_id uuid,
  p_contract_body text
)
returns public.subscription_plans
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_plan public.subscription_plans;
begin
  if not public.is_organization_owner(p_organization_id) then raise exception using errcode='42501', message='subscription contract denied'; end if;
  if not public.organization_module_enabled(p_organization_id, 'subscription_plans') then raise exception using errcode='42501', message='subscription module disabled'; end if;
  if p_contract_body is not null and char_length(btrim(p_contract_body)) < 20 then raise exception using errcode='22023', message='contract body is too short'; end if;
  update public.subscription_plans
     set contract_body_override = nullif(btrim(p_contract_body), ''), updated_at = now()
   where id = p_plan_id and organization_id = p_organization_id
   returning * into v_plan;
  if v_plan.id is null then raise exception using errcode='P0002', message='subscription plan not found'; end if;
  return v_plan;
end;
$$;

revoke all on function public.snapshot_subscription_contract() from public, anon, authenticated;
revoke all on function public.set_subscription_plan_contract(uuid,uuid,text) from public, anon;
grant execute on function public.set_subscription_plan_contract(uuid,uuid,text) to authenticated;
