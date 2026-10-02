-- Shared commission configuration for packages and subscription plans.
-- Catalog assignments are separate from their rates so existing commission
-- rules for services remain unchanged.

alter table public.commission_rules
  add column package_id uuid,
  add column subscription_plan_id uuid,
  add constraint commission_rules_package_fk
    foreign key (package_id, organization_id)
    references public.packages(id, organization_id),
  add constraint commission_rules_subscription_plan_fk
    foreign key (subscription_plan_id, organization_id)
    references public.subscription_plans(id, organization_id),
  add constraint commission_rules_single_target_check
    check (num_nonnulls(service_id, package_id, subscription_plan_id) <= 1);

drop index public.commission_rules_one_active_scope;
create unique index commission_rules_one_active_scope
  on public.commission_rules (
    organization_id,
    coalesce(barber_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(service_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(package_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(subscription_plan_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) where active;

-- Keep the legacy service/default commission editor isolated from catalog rules.
create or replace function public.replace_commission_rule(
  p_organization_id uuid,p_barber_id uuid,p_service_id uuid,
  p_mode public.commission_mode,p_percentage_bps integer,p_fixed_cents bigint,
  p_effective_at timestamptz default now(),p_current_rule_id uuid default null
)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_current public.commission_rules%rowtype; v_new_id uuid;
begin
  if not public.is_organization_owner(p_organization_id) or not public.organization_allows_management_mutations(p_organization_id) then
    raise exception using errcode='42501',message='organization owner required';
  end if;
  if p_effective_at>now()+interval '1 minute' then raise exception using errcode='22023',message='future commission activation is not supported in MVP'; end if;
  if p_barber_id is not null and not exists(select 1 from public.barbers where id=p_barber_id and organization_id=p_organization_id) then
    raise exception using errcode='P0002',message='tenant barber not found';
  end if;
  if p_service_id is not null and not exists(select 1 from public.services where id=p_service_id and organization_id=p_organization_id) then
    raise exception using errcode='P0002',message='tenant service not found';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||coalesce(p_barber_id::text,'*')||':'||coalesce(p_service_id::text,'*'),0));
  if p_current_rule_id is not null then
    select * into strict v_current from public.commission_rules where id=p_current_rule_id and organization_id=p_organization_id and active for update;
    if v_current.barber_id is distinct from p_barber_id or v_current.service_id is distinct from p_service_id
       or v_current.package_id is not null or v_current.subscription_plan_id is not null then
      raise exception using errcode='22023',message='commission rule scope cannot be reassigned';
    end if;
  else
    select * into v_current from public.commission_rules where organization_id=p_organization_id and active
      and barber_id is not distinct from p_barber_id and service_id is not distinct from p_service_id
      and package_id is null and subscription_plan_id is null for update;
  end if;
  if v_current.id is not null then
    if p_effective_at<=lower(v_current.effective_period) then raise exception using errcode='22023',message='replacement must start after current commission rule'; end if;
    update public.commission_rules set active=false,effective_period=tstzrange(lower(v_current.effective_period),p_effective_at,'[)') where id=v_current.id;
  end if;
  insert into public.commission_rules(organization_id,barber_id,service_id,mode,percentage_bps,fixed_cents,effective_period,active,created_by)
  values(p_organization_id,p_barber_id,p_service_id,p_mode,p_percentage_bps,p_fixed_cents,tstzrange(p_effective_at,null,'[)'),true,auth.uid()) returning id into v_new_id;
  return v_new_id;
exception when no_data_found then raise exception using errcode='P0002',message='active tenant commission rule not found';
end $$;

create table public.barber_packages (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  barber_id uuid not null,
  package_id uuid not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (barber_id, package_id),
  foreign key (barber_id, organization_id) references public.barbers(id, organization_id) on delete cascade,
  foreign key (package_id, organization_id) references public.packages(id, organization_id) on delete cascade
);

create table public.barber_subscription_plans (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  barber_id uuid not null,
  plan_id uuid not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (barber_id, plan_id),
  foreign key (barber_id, organization_id) references public.barbers(id, organization_id) on delete cascade,
  foreign key (plan_id, organization_id) references public.subscription_plans(id, organization_id) on delete cascade
);

alter table public.barber_packages enable row level security;
alter table public.barber_packages force row level security;
alter table public.barber_subscription_plans enable row level security;
alter table public.barber_subscription_plans force row level security;
create policy barber_packages_tenant_select on public.barber_packages
  for select to authenticated using (public.can_access_organization(organization_id));
create policy barber_packages_owner_write on public.barber_packages
  for all to authenticated using (
    public.is_organization_owner(organization_id)
    and public.organization_allows_management_mutations(organization_id)
  ) with check (
    public.is_organization_owner(organization_id)
    and public.organization_allows_management_mutations(organization_id)
  );
create policy barber_subscription_plans_tenant_select on public.barber_subscription_plans
  for select to authenticated using (public.can_access_organization(organization_id));
create policy barber_subscription_plans_owner_write on public.barber_subscription_plans
  for all to authenticated using (
    public.is_organization_owner(organization_id)
    and public.organization_allows_management_mutations(organization_id)
  ) with check (
    public.is_organization_owner(organization_id)
    and public.organization_allows_management_mutations(organization_id)
  );
grant select, insert, update, delete on public.barber_packages, public.barber_subscription_plans to authenticated;

-- Preserve current booking eligibility for existing catalog items.
insert into public.barber_packages(organization_id, barber_id, package_id)
select package.organization_id, barber.id, package.id
from public.packages package
join public.barbers barber on barber.organization_id = package.organization_id and barber.active
where package.active
  and exists (
    select 1 from public.package_items item
    where item.organization_id = package.organization_id and item.package_id = package.id and item.active
  )
  and not exists (
    select 1
    from public.package_items item
    where item.organization_id = package.organization_id and item.package_id = package.id and item.active
      and not exists (
        select 1 from public.barber_services skill
        where skill.organization_id = item.organization_id and skill.barber_id = barber.id
          and skill.service_id = item.service_id and skill.active
      )
  )
on conflict (barber_id, package_id) do nothing;

insert into public.barber_subscription_plans(organization_id, barber_id, plan_id)
select plan.organization_id, barber.id, plan.id
from public.subscription_plans plan
join public.barbers barber on barber.organization_id = plan.organization_id and barber.active
join lateral (
  select version.id
  from public.subscription_plan_versions version
  where version.organization_id = plan.organization_id and version.plan_id = plan.id
  order by version.version desc limit 1
) latest on true
where plan.active
  and exists (
    select 1 from public.subscription_plan_services item
    where item.organization_id = plan.organization_id and item.plan_version_id = latest.id
  )
  and not exists (
    select 1 from public.subscription_plan_services item
    where item.organization_id = plan.organization_id and item.plan_version_id = latest.id
      and not exists (
        select 1 from public.barber_services skill
        where skill.organization_id = item.organization_id and skill.barber_id = barber.id
          and skill.service_id = item.service_id and skill.active
      )
  )
on conflict (barber_id, plan_id) do nothing;

create or replace function public.replace_catalog_commission_rule(
  p_organization_id uuid,
  p_barber_id uuid,
  p_target_kind text,
  p_target_id uuid,
  p_enabled boolean,
  p_mode public.commission_mode,
  p_percentage_bps integer,
  p_fixed_cents bigint,
  p_effective_at timestamptz default now(),
  p_current_rule_id uuid default null
)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_current public.commission_rules%rowtype;
  v_service_id uuid;
  v_package_id uuid;
  v_plan_id uuid;
  v_lock_key text;
  v_new_id uuid;
begin
  if not public.is_organization_owner(p_organization_id)
     or not public.organization_allows_management_mutations(p_organization_id) then
    raise exception using errcode='42501', message='commission changes denied';
  end if;
  if p_barber_id is null or not exists (
    select 1 from public.barbers where id=p_barber_id and organization_id=p_organization_id
  ) then raise exception using errcode='P0002', message='tenant barber not found'; end if;
  if p_target_kind = 'PACKAGE' then
    v_package_id := p_target_id;
    if not exists (select 1 from public.packages where id=p_target_id and organization_id=p_organization_id) then
      raise exception using errcode='P0002', message='tenant package not found';
    end if;
  elsif p_target_kind = 'SUBSCRIPTION_PLAN' then
    v_plan_id := p_target_id;
    if not exists (select 1 from public.subscription_plans where id=p_target_id and organization_id=p_organization_id) then
      raise exception using errcode='P0002', message='tenant subscription plan not found';
    end if;
  else
    raise exception using errcode='22023', message='invalid commission target';
  end if;
  if p_enabled and (p_mode is null or (p_mode='PERCENT' and (p_percentage_bps not between 0 and 10000 or p_fixed_cents is not null))
      or (p_mode='FIXED' and (p_fixed_cents is null or p_fixed_cents < 0 or p_percentage_bps is not null))) then
    raise exception using errcode='22023', message='invalid commission amount';
  end if;
  v_lock_key := p_organization_id::text || ':' || p_barber_id::text || ':' || p_target_kind || ':' || p_target_id::text;
  perform pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));
  select * into v_current from public.commission_rules
   where organization_id=p_organization_id and barber_id=p_barber_id and active
     and package_id is not distinct from v_package_id
     and subscription_plan_id is not distinct from v_plan_id
     and service_id is null for update;
  if p_current_rule_id is not null and v_current.id is distinct from p_current_rule_id then
    raise exception using errcode='40001', message='commission rule changed; reload and try again';
  end if;
  if not p_enabled then
    if v_current.id is not null then
      if p_effective_at <= lower(v_current.effective_period) then
        raise exception using errcode='22023', message='commission end must follow its start';
      end if;
      update public.commission_rules set active=false,
        effective_period=tstzrange(lower(v_current.effective_period),p_effective_at,'[)')
       where id=v_current.id and organization_id=p_organization_id;
    end if;
    return null;
  end if;
  if v_current.id is not null and v_current.mode=p_mode
     and v_current.percentage_bps is not distinct from p_percentage_bps
     and v_current.fixed_cents is not distinct from p_fixed_cents then
    return v_current.id;
  end if;
  if v_current.id is not null then
    if p_effective_at <= lower(v_current.effective_period) then
      raise exception using errcode='22023', message='replacement must start after current commission rule';
    end if;
    update public.commission_rules set active=false,
      effective_period=tstzrange(lower(v_current.effective_period),p_effective_at,'[)')
     where id=v_current.id and organization_id=p_organization_id;
  end if;
  insert into public.commission_rules(
    organization_id,barber_id,service_id,package_id,subscription_plan_id,
    mode,percentage_bps,fixed_cents,effective_period,active,created_by
  ) values (
    p_organization_id,p_barber_id,null,v_package_id,v_plan_id,
    p_mode,p_percentage_bps,p_fixed_cents,tstzrange(p_effective_at,null,'[)'),true,auth.uid()
  ) returning id into v_new_id;
  return v_new_id;
end $$;
revoke all on function public.replace_catalog_commission_rule(uuid,uuid,text,uuid,boolean,public.commission_mode,integer,bigint,timestamptz,uuid) from public, anon;
grant execute on function public.replace_catalog_commission_rule(uuid,uuid,text,uuid,boolean,public.commission_mode,integer,bigint,timestamptz,uuid) to authenticated;

create or replace function public.save_barber_catalog_commissions(
  p_organization_id uuid,
  p_barber_id uuid,
  p_packages jsonb,
  p_subscription_plans jsonb
)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_item jsonb;
  v_target uuid;
  v_enabled boolean;
  v_mode public.commission_mode;
  v_percentage integer;
  v_fixed bigint;
  v_kind text;
  v_seen uuid[];
begin
  if not public.is_organization_owner(p_organization_id)
     or not public.organization_allows_management_mutations(p_organization_id) then
    raise exception using errcode='42501',message='catalog commission changes denied';
  end if;
  if not exists(select 1 from public.barbers where id=p_barber_id and organization_id=p_organization_id) then
    raise exception using errcode='P0002',message='tenant barber not found';
  end if;
  if jsonb_typeof(p_packages)<>'array' or jsonb_typeof(p_subscription_plans)<>'array' then
    raise exception using errcode='22023',message='catalog commission inputs must be arrays';
  end if;
  foreach v_kind in array array['PACKAGE','SUBSCRIPTION_PLAN'] loop
    v_seen := array[]::uuid[];
    for v_item in select value from jsonb_array_elements(case when v_kind='PACKAGE' then p_packages else p_subscription_plans end)
    loop
      v_target := (v_item->>'id')::uuid;
      v_enabled := coalesce((v_item->>'enabled')::boolean,false);
      if v_target = any(v_seen) then raise exception using errcode='22023',message='duplicate catalog commission target'; end if;
      v_seen := array_append(v_seen,v_target);
      if v_kind='PACKAGE' then
        if not exists(select 1 from public.packages where id=v_target and organization_id=p_organization_id) then
          raise exception using errcode='P0002',message='tenant package not found';
        end if;
        if v_enabled and exists(
          select 1 from public.package_items item
          where item.organization_id=p_organization_id and item.package_id=v_target and item.active
            and not exists(select 1 from public.barber_services skill where skill.organization_id=p_organization_id
              and skill.barber_id=p_barber_id and skill.service_id=item.service_id and skill.active)
        ) then raise exception using errcode='22023',message='professional must be enabled for every service in this package'; end if;
        insert into public.barber_packages(organization_id,barber_id,package_id,active)
        values(p_organization_id,p_barber_id,v_target,v_enabled)
        on conflict(barber_id,package_id) do update set active=excluded.active;
      else
        if not exists(select 1 from public.subscription_plans where id=v_target and organization_id=p_organization_id) then
          raise exception using errcode='P0002',message='tenant subscription plan not found';
        end if;
        if v_enabled and exists(
          select 1 from public.subscription_plans plan
          join lateral (select version.id from public.subscription_plan_versions version
            where version.organization_id=plan.organization_id and version.plan_id=plan.id
            order by version.version desc limit 1) latest on true
          join public.subscription_plan_services item on item.organization_id=plan.organization_id and item.plan_version_id=latest.id
          where plan.organization_id=p_organization_id and plan.id=v_target
            and not exists(select 1 from public.barber_services skill where skill.organization_id=p_organization_id
              and skill.barber_id=p_barber_id and skill.service_id=item.service_id and skill.active)
        ) then raise exception using errcode='22023',message='professional must be enabled for every service in this plan'; end if;
        insert into public.barber_subscription_plans(organization_id,barber_id,plan_id,active)
        values(p_organization_id,p_barber_id,v_target,v_enabled)
        on conflict(barber_id,plan_id) do update set active=excluded.active;
      end if;
      if not v_enabled then
        perform public.replace_catalog_commission_rule(p_organization_id,p_barber_id,v_kind,v_target,false,'PERCENT',null,null,now(),null);
      elsif nullif(btrim(v_item->>'value_present'),'')='true' then
        v_mode := (v_item->>'mode')::public.commission_mode;
        v_percentage := nullif(v_item->>'percentage_bps','')::integer;
        v_fixed := nullif(v_item->>'fixed_cents','')::bigint;
        perform public.replace_catalog_commission_rule(p_organization_id,p_barber_id,v_kind,v_target,true,v_mode,v_percentage,v_fixed,now(),null);
      end if;
    end loop;
  end loop;
end $$;
revoke all on function public.save_barber_catalog_commissions(uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.save_barber_catalog_commissions(uuid,uuid,jsonb,jsonb) to authenticated;

alter table public.appointment_items
  add column commission_scope_snapshot text not null default 'SERVICE'
    check (commission_scope_snapshot in ('SERVICE','PACKAGE'));
alter table public.customer_subscription_sessions
  add column commission_mode_snapshot public.commission_mode,
  add column commission_percentage_bps_snapshot integer,
  add column commission_fixed_cents_snapshot bigint,
  add constraint customer_subscription_sessions_commission_snapshot_check check (
    (commission_mode_snapshot is null and commission_percentage_bps_snapshot is null and commission_fixed_cents_snapshot is null)
    or (commission_mode_snapshot='PERCENT' and commission_percentage_bps_snapshot between 0 and 10000 and commission_fixed_cents_snapshot is null)
    or (commission_mode_snapshot='FIXED' and commission_fixed_cents_snapshot >= 0 and commission_percentage_bps_snapshot is null)
  );
alter table public.commission_ledger add column subscription_session_id uuid;
alter table public.commission_ledger add constraint commission_ledger_subscription_session_fk
  foreign key (subscription_session_id,organization_id)
  references public.customer_subscription_sessions(id,organization_id);
alter table public.commission_ledger add constraint commission_ledger_session_source_check
  check (subscription_session_id is null or (kind='EARNED' and appointment_id is not null and appointment_item_id is null and project_internal_service_id is null));
create unique index commission_ledger_subscription_session_earned_key
  on public.commission_ledger(organization_id,subscription_session_id)
  where kind='EARNED' and subscription_session_id is not null;

create or replace function public.apply_package_commission_snapshot()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_barber_id uuid;
  v_rule public.commission_rules%rowtype;
  v_rule_count integer;
  v_package public.packages%rowtype;
  v_line_number integer;
  v_line_count integer;
  v_line_charge bigint;
  v_prior_commission bigint;
begin
  if new.source <> 'PACKAGE' then return new; end if;
  select barber_id into strict v_barber_id from public.appointments
   where id=new.appointment_id and organization_id=new.organization_id;
  if not exists(select 1 from public.barber_packages assignment where assignment.organization_id=new.organization_id
      and assignment.barber_id=v_barber_id and assignment.package_id=new.package_id and assignment.active) then
    raise exception using errcode='22023',message='professional is not configured for this package';
  end if;
  select count(*) into v_rule_count from public.commission_rules rule
   where rule.organization_id=new.organization_id and rule.package_id=new.package_id
     and rule.active and rule.effective_period @> now();
  select * into v_rule from public.commission_rules rule
   where rule.organization_id=new.organization_id and rule.barber_id=v_barber_id
     and rule.package_id=new.package_id and rule.active and rule.effective_period @> now()
   order by lower(rule.effective_period) desc limit 1;
  if v_rule_count > 0 and v_rule.id is null then
    raise exception using errcode='22023', message='professional is not configured for this package';
  end if;
  if v_rule.id is null then return new; end if;
  select * into strict v_package from public.packages
   where id=new.package_id and organization_id=new.organization_id;
  new.commission_scope_snapshot := 'PACKAGE';
  new.commission_mode_snapshot := v_rule.mode;
  new.commission_percentage_bps_snapshot := v_rule.percentage_bps;
  if v_rule.mode='PERCENT' then
    new.commission_fixed_cents_snapshot := null;
  else
    select line_number,line_count into v_line_number,v_line_count
    from (
      select item.id,
        row_number() over (order by item.position,item.id)::integer line_number,
        count(*) over ()::integer line_count
      from public.package_items item
      where item.organization_id=new.organization_id and item.package_id=new.package_id and item.active
    ) ordered where id=new.package_item_id;
    with lines as (
      select item.id,item.position,item.quantity,service.price_cents,
        sum(service.price_cents*item.quantity) over ()::bigint list_total,
        row_number() over (order by item.position,item.id)::integer line_number,
        count(*) over ()::integer line_count
      from public.package_items item join public.services service
        on service.id=item.service_id and service.organization_id=item.organization_id
      where item.organization_id=new.organization_id and item.package_id=new.package_id and item.active
    ), base as (
      select lines.*,
        case when list_total=0 then 0
             else floor(v_package.price_cents::numeric*(price_cents*quantity)::numeric/list_total)::bigint end base_charge
      from lines
    ), charges as (
      select base.*,
        case when line_number=line_count then v_package.price_cents-coalesce(sum(base_charge) filter(where line_number<line_count) over (),0)
             when list_total=0 then 0 else base_charge end charged
      from base
    )
    select charged,line_number,line_count into v_line_charge,v_line_number,v_line_count
    from charges where id=new.package_item_id;
    if v_package.price_cents=0 then
      new.commission_fixed_cents_snapshot := case when v_line_number=v_line_count then v_rule.fixed_cents else 0 end;
    else
      with lines as (
        select item.id,item.position,item.quantity,service.price_cents,
          sum(service.price_cents*item.quantity) over ()::bigint list_total,
          row_number() over(order by item.position,item.id)::integer line_number,
          count(*) over()::integer line_count
        from public.package_items item join public.services service
          on service.id=item.service_id and service.organization_id=item.organization_id
        where item.organization_id=new.organization_id and item.package_id=new.package_id and item.active
      ), base as (
        select lines.*,case when list_total=0 then 0
          else floor(v_package.price_cents::numeric*(price_cents*quantity)::numeric/list_total)::bigint end base_charge
        from lines
      ), charges as (
        select base.*,case when line_number=line_count then v_package.price_cents-coalesce(sum(base_charge) filter(where line_number<line_count) over (),0)
          when list_total=0 then 0 else base_charge end charged from base
      ), commission_parts as (
        select charges.*,floor(v_rule.fixed_cents::numeric*charged/v_package.price_cents)::bigint commission_base
        from charges
      )
      select case when line_number=line_count then v_rule.fixed_cents-coalesce(sum(commission_base) filter(where line_number<line_count) over (),0)
                  else commission_base end
        into new.commission_fixed_cents_snapshot
      from commission_parts where id=new.package_item_id;
    end if;
  end if;
  return new;
end $$;
create trigger appointment_items_package_commission_snapshot
  before insert on public.appointment_items
  for each row execute function public.apply_package_commission_snapshot();
revoke all on function public.apply_package_commission_snapshot() from public,anon,authenticated,service_role;

create or replace function public.ensure_commission_for_received_appointment(p_appointment_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_appointment public.appointments%rowtype;
  v_list_total bigint;
  v_final_total bigint;
  v_commission bigint;
  v_item public.appointment_items%rowtype;
begin
  select * into strict v_appointment from public.appointments where id=p_appointment_id for update;
  if v_appointment.status <> 'COMPLETED' or v_appointment.payment_mode='SUBSCRIPTION'
     or not public.appointment_is_fully_received(v_appointment.id) then return; end if;
  select coalesce(sum(item.list_price_cents_snapshot*item.quantity),0)::bigint into v_list_total
    from public.appointment_items item where item.organization_id=v_appointment.organization_id and item.appointment_id=v_appointment.id;
  select greatest(coalesce((select adjustment.final_total_cents from public.appointment_amount_adjustments adjustment
    where adjustment.organization_id=v_appointment.organization_id and adjustment.appointment_id=v_appointment.id
    order by adjustment.created_at desc,adjustment.id desc limit 1),v_appointment.total_cents_snapshot)-v_appointment.amount_waived_cents,0)
    into v_final_total;
  for v_item in select * from public.appointment_items item where item.organization_id=v_appointment.organization_id
      and item.appointment_id=v_appointment.id order by item.position
  loop
    v_commission := case v_item.commission_mode_snapshot
      when 'PERCENT' then case when v_list_total>0 then round(v_final_total::numeric
        *(v_item.list_price_cents_snapshot*v_item.quantity)::numeric/v_list_total
        *v_item.commission_percentage_bps_snapshot/10000)::bigint else 0 end
      when 'FIXED' then case when v_item.commission_scope_snapshot='PACKAGE'
        then v_item.commission_fixed_cents_snapshot
        else v_item.commission_fixed_cents_snapshot*v_item.quantity end
      else 0 end;
    if v_commission>0 then
      insert into public.commission_ledger(organization_id,barber_id,appointment_id,appointment_item_id,kind,amount_cents,idempotency_key,earned_at,created_by)
      values(v_appointment.organization_id,v_appointment.barber_id,v_appointment.id,v_item.id,'EARNED',v_commission,
        'earned:'||v_appointment.id||':'||v_item.id,now(),auth.uid())
      on conflict (organization_id,idempotency_key) do nothing;
    end if;
  end loop;
exception when no_data_found then return;
end $$;
revoke all on function public.ensure_commission_for_received_appointment(uuid) from public,anon,authenticated,service_role;

create or replace function public.snapshot_subscription_session_commission()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_plan_id uuid;
  v_barber_id uuid;
  v_rule public.commission_rules%rowtype;
  v_rule_count integer;
begin
  if new.status <> 'SCHEDULED' or new.appointment_id is null then return new; end if;
  select subscription.plan_id,appointment.barber_id into strict v_plan_id,v_barber_id
  from public.customer_subscriptions subscription
  join public.appointments appointment on appointment.id=new.appointment_id and appointment.organization_id=new.organization_id
  where subscription.id=new.subscription_id and subscription.organization_id=new.organization_id;
  select count(*) into v_rule_count from public.commission_rules rule
  where rule.organization_id=new.organization_id and rule.subscription_plan_id=v_plan_id
    and rule.active and rule.effective_period @> now();
  select * into v_rule from public.commission_rules rule
  where rule.organization_id=new.organization_id and rule.barber_id=v_barber_id
    and rule.subscription_plan_id=v_plan_id and rule.active and rule.effective_period @> now()
  order by lower(rule.effective_period) desc limit 1;
  if v_rule_count>0 and v_rule.id is null then
    raise exception using errcode='22023',message='professional is not configured for this subscription plan';
  end if;
  new.commission_mode_snapshot := v_rule.mode;
  new.commission_percentage_bps_snapshot := v_rule.percentage_bps;
  new.commission_fixed_cents_snapshot := v_rule.fixed_cents;
  return new;
end $$;
create trigger customer_subscription_session_commission_snapshot
  before insert or update on public.customer_subscription_sessions
  for each row execute function public.snapshot_subscription_session_commission();
revoke all on function public.snapshot_subscription_session_commission() from public,anon,authenticated,service_role;

create or replace function public.validate_subscription_session_professional()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_plan_id uuid; v_session_id uuid;
begin
  if tg_op='UPDATE' and new.barber_id is not distinct from old.barber_id then return new; end if;
  select session.id,subscription.plan_id into v_session_id,v_plan_id
  from public.customer_subscription_sessions session
  join public.customer_subscriptions subscription on subscription.id=session.subscription_id and subscription.organization_id=session.organization_id
  where session.organization_id=new.organization_id and session.appointment_id=new.id
    and session.status in ('SCHEDULED','COMPLETED') limit 1;
  if v_session_id is not null and not exists(select 1 from public.barber_subscription_plans assignment
    where assignment.organization_id=new.organization_id and assignment.barber_id=new.barber_id
      and assignment.plan_id=v_plan_id and assignment.active) then
    raise exception using errcode='22023',message='professional is not configured for this subscription plan';
  end if;
  return new;
end $$;
create trigger appointment_subscription_professional_check
  before update of barber_id on public.appointments
  for each row execute function public.validate_subscription_session_professional();
revoke all on function public.validate_subscription_session_professional() from public,anon,authenticated,service_role;

create or replace function public.refresh_subscription_session_commission_snapshot()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.barber_id is distinct from old.barber_id and new.subscription_session_id is not null then
    update public.customer_subscription_sessions set appointment_id=appointment_id
     where id=new.subscription_session_id and organization_id=new.organization_id;
  end if;
  return new;
end $$;
create trigger appointment_subscription_commission_snapshot_refresh
  after update of barber_id on public.appointments
  for each row execute function public.refresh_subscription_session_commission_snapshot();
revoke all on function public.refresh_subscription_session_commission_snapshot() from public,anon,authenticated,service_role;

create or replace function public.ensure_subscription_session_commission(p_session_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_session public.customer_subscription_sessions%rowtype;
  v_cycle public.customer_subscription_cycles%rowtype;
  v_plan public.subscription_plan_versions%rowtype;
  v_appointment public.appointments%rowtype;
  v_base_cents bigint;
  v_commission bigint;
begin
  select * into v_session from public.customer_subscription_sessions where id=p_session_id for update;
  if v_session.id is null or v_session.status<>'COMPLETED' or v_session.appointment_id is null
     or v_session.commission_mode_snapshot is null then return; end if;
  select * into strict v_cycle from public.customer_subscription_cycles
   where id=v_session.cycle_id and organization_id=v_session.organization_id;
  if v_cycle.status<>'PAID' then return; end if;
  select * into strict v_appointment from public.appointments
   where id=v_session.appointment_id and organization_id=v_session.organization_id;
  if v_appointment.status<>'COMPLETED' then return; end if;
  select version.* into strict v_plan from public.customer_subscriptions subscription
  join public.subscription_plan_versions version on version.id=subscription.plan_version_id and version.organization_id=subscription.organization_id
  where subscription.id=v_session.subscription_id and subscription.organization_id=v_session.organization_id;
  v_base_cents := v_cycle.amount_cents/v_plan.sessions_per_cycle;
  if v_session.session_number=v_plan.sessions_per_cycle then
    v_base_cents := v_cycle.amount_cents-v_base_cents*(v_plan.sessions_per_cycle-1);
  end if;
  v_commission := case v_session.commission_mode_snapshot
    when 'PERCENT' then round(v_base_cents::numeric*v_session.commission_percentage_bps_snapshot/10000)::bigint
    when 'FIXED' then v_session.commission_fixed_cents_snapshot
    else 0 end;
  if v_commission<=0 then return; end if;
  insert into public.commission_ledger(organization_id,barber_id,appointment_id,subscription_session_id,kind,amount_cents,idempotency_key,earned_at,created_by)
  values(v_session.organization_id,v_appointment.barber_id,v_appointment.id,v_session.id,'EARNED',v_commission,
    'subscription-session-earned:'||v_session.id,now(),auth.uid()) on conflict (organization_id,idempotency_key) do nothing;
exception when no_data_found then return;
end $$;
revoke all on function public.ensure_subscription_session_commission(uuid) from public,anon,authenticated,service_role;

create or replace function public.award_subscription_session_commission_after_completion()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.status='COMPLETED' and old.status is distinct from new.status then
    perform public.ensure_subscription_session_commission(new.id);
  end if;
  return new;
end $$;
create trigger customer_subscription_session_commission_after_completion
  after update on public.customer_subscription_sessions
  for each row execute function public.award_subscription_session_commission_after_completion();

create or replace function public.award_paid_cycle_session_commissions()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_session record;
begin
  if new.status='PAID' and (tg_op='INSERT' or old.status is distinct from new.status) then
    for v_session in select id from public.customer_subscription_sessions
      where organization_id=new.organization_id and cycle_id=new.id and status='COMPLETED'
    loop perform public.ensure_subscription_session_commission(v_session.id); end loop;
  end if;
  return new;
end $$;
create trigger customer_subscription_cycle_commission_after_payment
  after insert or update on public.customer_subscription_cycles
  for each row execute function public.award_paid_cycle_session_commissions();
revoke all on function public.award_subscription_session_commission_after_completion(),public.award_paid_cycle_session_commissions() from public,anon,authenticated,service_role;

-- Reuse the existing transactional booking routines while adding catalog assignment gates.
alter function public.resolve_booking_selection(uuid,uuid,jsonb,uuid) rename to resolve_booking_selection_before_catalog_commissions;
revoke all on function public.resolve_booking_selection_before_catalog_commissions(uuid,uuid,jsonb,uuid) from public,anon,authenticated,service_role;
create or replace function public.resolve_booking_selection(p_organization_id uuid,p_barber_id uuid,p_selections jsonb,p_appointment_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_selection jsonb; v_package_id uuid;
begin
  for v_selection in select value from jsonb_array_elements(p_selections)
  loop
    if upper(coalesce(v_selection->>'type',''))='PACKAGE' then
      v_package_id := coalesce(v_selection->>'package_id',v_selection->>'id')::uuid;
      if not exists(select 1 from public.barber_packages assignment where assignment.organization_id=p_organization_id
        and assignment.barber_id=p_barber_id and assignment.package_id=v_package_id and assignment.active) then
        raise exception using errcode='22023',message='professional is not configured for this package';
      end if;
    end if;
  end loop;
  return public.resolve_booking_selection_before_catalog_commissions(p_organization_id,p_barber_id,p_selections,p_appointment_id);
end $$;
revoke all on function public.resolve_booking_selection(uuid,uuid,jsonb,uuid) from public,anon;

alter function public.book_customer_subscription_session(uuid,uuid,uuid,uuid,timestamptz) rename to book_customer_subscription_session_before_catalog_commissions;
revoke all on function public.book_customer_subscription_session_before_catalog_commissions(uuid,uuid,uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
create or replace function public.book_customer_subscription_session(p_organization_id uuid,p_customer_id uuid,p_subscription_session_id uuid,p_barber_id uuid,p_starts_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_plan_id uuid;
begin
  select subscription.plan_id into strict v_plan_id
  from public.customer_subscription_sessions session
  join public.customer_subscriptions subscription on subscription.id=session.subscription_id and subscription.organization_id=session.organization_id
  where session.id=p_subscription_session_id and session.organization_id=p_organization_id;
  if not exists(select 1 from public.barber_subscription_plans assignment where assignment.organization_id=p_organization_id
    and assignment.barber_id=p_barber_id and assignment.plan_id=v_plan_id and assignment.active) then
    raise exception using errcode='22023',message='professional is not configured for this subscription plan';
  end if;
  return public.book_customer_subscription_session_before_catalog_commissions(p_organization_id,p_customer_id,p_subscription_session_id,p_barber_id,p_starts_at);
exception when no_data_found then raise exception using errcode='P0002',message='subscription session not found';
end $$;
revoke all on function public.book_customer_subscription_session(uuid,uuid,uuid,uuid,timestamptz) from public,anon;
grant execute on function public.book_customer_subscription_session(uuid,uuid,uuid,uuid,timestamptz) to authenticated;

alter function public.fixed_subscription_schedule_preview(uuid,uuid,uuid,date,time,smallint,text) rename to fixed_subscription_schedule_preview_before_catalog_commissions;
revoke all on function public.fixed_subscription_schedule_preview_before_catalog_commissions(uuid,uuid,uuid,date,time,smallint,text) from public,anon,authenticated,service_role;
create or replace function public.fixed_subscription_schedule_preview(p_organization_id uuid,p_plan_version_id uuid,p_barber_id uuid,p_start_date date,p_local_time time,p_cadence_weeks smallint,p_timezone text)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_plan_id uuid;
begin
  select plan_id into strict v_plan_id from public.subscription_plan_versions
   where id=p_plan_version_id and organization_id=p_organization_id;
  if not exists(select 1 from public.barber_subscription_plans assignment where assignment.organization_id=p_organization_id
    and assignment.barber_id=p_barber_id and assignment.plan_id=v_plan_id and assignment.active) then
    raise exception using errcode='22023',message='professional is not configured for this subscription plan';
  end if;
  return public.fixed_subscription_schedule_preview_before_catalog_commissions(p_organization_id,p_plan_version_id,p_barber_id,p_start_date,p_local_time,p_cadence_weeks,p_timezone);
exception when no_data_found then raise exception using errcode='P0002',message='subscription plan not found';
end $$;
revoke all on function public.fixed_subscription_schedule_preview(uuid,uuid,uuid,date,time,smallint,text) from public,anon,authenticated;

-- Public context contains only active, tenant-scoped assignments needed by the booking UI.
create or replace function public.get_public_booking_context(p_organization_slug text)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  with requested_slug as (select lower(btrim(p_organization_slug)) as slug)
  select jsonb_build_object(
    'organization', jsonb_build_object(
      'id',o.id,'name',o.name,'slug',o.slug,'timezone',o.timezone,'currency',o.currency,
      'deposit_bps',o.deposit_bps,'cancellation_lead_minutes',o.cancellation_lead_minutes,
      'accepting_bookings',public.organization_accepts_new_bookings(o.id),'booking_public_id',o.booking_public_id,
      'logo_path',o.logo_path,'public_contact_phone_e164',o.public_contact_phone_e164
    ),
    'location',(select jsonb_build_object('id',l.id,'name',l.name,'address',l.address) from public.locations l where l.organization_id=o.id and l.active limit 1),
    'services',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'description',s.description,'price_cents',s.price_cents,'duration_minutes',s.duration_minutes,'audiences',s.audiences) order by s.sort_order,s.name) from public.services s where s.organization_id=o.id and s.active and s.availability='CLIENT' and cardinality(s.audiences)>0),'[]'::jsonb),
    'packages',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'description',p.description,'price_cents',p.price_cents,'duration_minutes',p.duration_minutes,'audiences',p.audiences,'items',coalesce((select jsonb_agg(jsonb_build_object('service_id',s.id,'name',s.name,'quantity',pi.quantity,'duration_minutes',s.duration_minutes) order by pi.position,s.name) from public.package_items pi join public.services s on s.id=pi.service_id and s.organization_id=pi.organization_id where pi.package_id=p.id and pi.organization_id=p.organization_id and pi.active and s.active and s.availability='CLIENT' and cardinality(s.audiences)>0),'[]'::jsonb)) order by p.sort_order,p.name) from public.packages p where p.organization_id=o.id and p.active and cardinality(p.audiences)>0 and exists(select 1 from public.package_items pi join public.services s on s.id=pi.service_id and s.organization_id=pi.organization_id where pi.package_id=p.id and pi.organization_id=p.organization_id and pi.active and s.active and s.availability='CLIENT' and cardinality(s.audiences)>0)),'[]'::jsonb),
    'barbers',coalesce((select jsonb_agg(jsonb_build_object(
      'id',b.id,'name',b.display_name,'bio',b.bio,'avatar_url',b.avatar_url,
      'service_ids',coalesce((select jsonb_agg(bs.service_id order by bs.service_id) from public.barber_services bs join public.services s on s.id=bs.service_id and s.organization_id=bs.organization_id where bs.organization_id=b.organization_id and bs.barber_id=b.id and bs.active and s.active and s.availability='CLIENT'),'[]'::jsonb),
      'package_ids',coalesce((select jsonb_agg(bp.package_id order by bp.package_id) from public.barber_packages bp where bp.organization_id=b.organization_id and bp.barber_id=b.id and bp.active),'[]'::jsonb),
      'subscription_plan_ids',coalesce((select jsonb_agg(bsp.plan_id order by bsp.plan_id) from public.barber_subscription_plans bsp where bsp.organization_id=b.organization_id and bsp.barber_id=b.id and bsp.active),'[]'::jsonb)
    ) order by b.display_name) from public.barbers b where b.organization_id=o.id and b.active),'[]'::jsonb)
  ) from public.organizations o cross join requested_slug r
  left join public.organization_slug_aliases a on a.organization_id=o.id and a.slug=r.slug
  where o.slug=r.slug or a.slug is not null;
$$;
revoke all on function public.get_public_booking_context(text) from public;
grant execute on function public.get_public_booking_context(text) to anon,authenticated;

create or replace function public.guard_unreceived_commission()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.kind='EARNED' and new.source_entry_id is null then
    if new.project_internal_service_id is not null then
      if not exists(select 1 from public.project_engagement_internal_services service
        where service.organization_id=new.organization_id and service.id=new.project_internal_service_id and service.status='COMPLETED') then return null; end if;
    elsif new.subscription_session_id is not null then
      if not exists(select 1 from public.customer_subscription_sessions session
        join public.customer_subscription_cycles cycle on cycle.id=session.cycle_id and cycle.organization_id=session.organization_id
        join public.appointments appointment on appointment.id=session.appointment_id and appointment.organization_id=session.organization_id
        where session.organization_id=new.organization_id and session.id=new.subscription_session_id
          and session.status='COMPLETED' and cycle.status='PAID' and appointment.status='COMPLETED'
          and appointment.id=new.appointment_id) then return null; end if;
    elsif new.idempotency_key like 'earned:%' and not public.appointment_is_fully_received(new.appointment_id) then
      return null;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_unreceived_commission() from public,anon,authenticated,service_role;

-- Include paid subscription sessions in the same payable commission workflow.
create or replace view public.commission_service_details with (security_invoker=true) as
select appointment_detail.organization_id,appointment_detail.appointment_id,appointment_detail.appointment_item_id,
  appointment_detail.customer_id,appointment_detail.customer_name,appointment_detail.barber_id,
  appointment_detail.service_id,appointment_detail.service_name,appointment_detail.location_id,appointment_detail.service_date,
  appointment_detail.service_value_paid_cents,appointment_detail.financial_account_names,appointment_detail.commission_cents,
  appointment_detail.paid_commission_cents,appointment_detail.payable_commission_cents,appointment_detail.received_on,
  appointment_detail.project_session_id,appointment_detail.project_engagement_id,appointment_detail.project_id,
  appointment_detail.is_project,'APPOINTMENT'::text source_type,null::uuid internal_service_id
from public.commission_service_appointment_details appointment_detail
union all
select internal_service.organization_id,null::uuid,null::uuid,null::uuid,null::text,internal_service.barber_id,
  internal_service.service_id,internal_service.service_name,null::uuid,internal_service.delivery_on,
  0::bigint,null::text,coalesce(ledger_totals.commission_cents,0)::bigint,
  coalesce(paid_totals.paid_commission_cents,0)::bigint,
  greatest(coalesce(ledger_totals.commission_cents,0)-coalesce(paid_totals.paid_commission_cents,0),0)::bigint,
  null::date,null::uuid,internal_service.engagement_id,internal_service.project_id,true,
  'PROJECT_INTERNAL'::text,internal_service.id
from public.project_engagement_internal_services internal_service
left join lateral (select sum(ledger.amount_cents)::bigint commission_cents from public.commission_ledger ledger
  where ledger.organization_id=internal_service.organization_id and ledger.project_internal_service_id=internal_service.id) ledger_totals on true
left join lateral (select greatest(sum(settlement.amount_cents-coalesce(reversals.amount_cents,0)),0)::bigint paid_commission_cents
  from public.commission_payout_items payout_item join public.commission_payout_settlements settlement
    on settlement.organization_id=payout_item.organization_id and settlement.payout_id=payout_item.payout_id
  left join (select organization_id,settlement_id,sum(amount_cents)::bigint amount_cents from public.commission_payout_settlement_reversals group by organization_id,settlement_id) reversals
    on reversals.organization_id=settlement.organization_id and reversals.settlement_id=settlement.id
  join public.commission_ledger ledger on ledger.organization_id=payout_item.organization_id and ledger.id=payout_item.ledger_entry_id
  where payout_item.organization_id=internal_service.organization_id and ledger.project_internal_service_id=internal_service.id) paid_totals on true
where internal_service.status='COMPLETED'
union all
select session.organization_id,appointment.id,null::uuid,appointment.customer_id,customer.full_name,appointment.barber_id,
  item.service_id,'Sessão de assinatura · '||plan.name,appointment.location_id,
  coalesce(completed.service_date,(lower(appointment.service_period) at time zone organization.timezone)::date),
  case when session.session_number=version.sessions_per_cycle
    then cycle.amount_cents-(cycle.amount_cents/version.sessions_per_cycle)*(version.sessions_per_cycle-1)
    else cycle.amount_cents/version.sessions_per_cycle end,'Fatura de assinatura recebida'::text,
  coalesce(ledger_totals.commission_cents,0)::bigint,coalesce(paid_totals.paid_commission_cents,0)::bigint,
  greatest(coalesce(ledger_totals.commission_cents,0)-coalesce(paid_totals.paid_commission_cents,0),0)::bigint,
  (cycle.paid_at at time zone organization.timezone)::date,null::uuid,null::uuid,null::uuid,false,
  'SUBSCRIPTION_SESSION'::text,session.id
from public.customer_subscription_sessions session
join public.customer_subscription_cycles cycle on cycle.id=session.cycle_id and cycle.organization_id=session.organization_id
join public.customer_subscriptions subscription on subscription.id=session.subscription_id and subscription.organization_id=session.organization_id
join public.subscription_plans plan on plan.id=subscription.plan_id and plan.organization_id=subscription.organization_id
join public.subscription_plan_versions version on version.id=subscription.plan_version_id and version.organization_id=subscription.organization_id
join public.appointments appointment on appointment.id=session.appointment_id and appointment.organization_id=session.organization_id
join public.customers customer on customer.id=appointment.customer_id and customer.organization_id=appointment.organization_id
join lateral (select appointment_item.service_id from public.appointment_items appointment_item
  where appointment_item.organization_id=appointment.organization_id and appointment_item.appointment_id=appointment.id
  order by appointment_item.position limit 1) item on true
join public.organizations organization on organization.id=session.organization_id
left join lateral (select min((event.created_at at time zone organization.timezone)::date) service_date
  from public.appointment_status_events event where event.organization_id=appointment.organization_id
    and event.appointment_id=appointment.id and event.to_status='COMPLETED') completed on true
left join lateral (select sum(ledger.amount_cents)::bigint commission_cents from public.commission_ledger ledger
  where ledger.organization_id=session.organization_id and ledger.subscription_session_id=session.id) ledger_totals on true
left join lateral (select greatest(sum(settlement.amount_cents-coalesce(reversals.amount_cents,0)),0)::bigint paid_commission_cents
  from public.commission_payout_items payout_item join public.commission_payout_settlements settlement
    on settlement.organization_id=payout_item.organization_id and settlement.payout_id=payout_item.payout_id
  left join (select organization_id,settlement_id,sum(amount_cents)::bigint amount_cents from public.commission_payout_settlement_reversals group by organization_id,settlement_id) reversals
    on reversals.organization_id=settlement.organization_id and reversals.settlement_id=settlement.id
  join public.commission_ledger ledger on ledger.organization_id=payout_item.organization_id and ledger.id=payout_item.ledger_entry_id
  where payout_item.organization_id=session.organization_id and ledger.subscription_session_id=session.id) paid_totals on true
where session.status='COMPLETED' and appointment.status='COMPLETED' and cycle.status='PAID'
  and coalesce(ledger_totals.commission_cents,0)>0;
grant select on public.commission_service_details to authenticated;

create or replace function public.pay_commission(
  p_organization_id uuid,p_barber_id uuid,p_period_start date,p_period_end date,
  p_appointment_item_ids uuid[],p_launch_on date,p_due_on date,p_financial_account_id uuid,
  p_payment_method public.financial_payment_method,p_document_number text,p_tags text,p_reference text,p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_payout public.commission_payouts%rowtype; v_settlement_id uuid; v_ledger public.commission_ledger%rowtype;
  v_selected_ids uuid[]; v_selected_count integer; v_amount bigint:=0;
begin
  perform public.require_financial_owner(p_organization_id,'commission payout');
  if p_period_start>p_period_end or p_launch_on is null or p_due_on is null
    or nullif(btrim(p_document_number),'') is null or nullif(btrim(p_idempotency_key),'') is null then
    raise exception using errcode='22023',message='valid period, dates, document number and idempotency key are required';
  end if;
  select array_agg(distinct selected_id order by selected_id) into v_selected_ids
    from unnest(coalesce(p_appointment_item_ids,'{}'::uuid[])) selected_id where selected_id is not null;
  if coalesce(cardinality(v_selected_ids),0)=0 then raise exception using errcode='22023',message='at least one commission must be selected'; end if;
  perform 1 from public.barbers where organization_id=p_organization_id and id=p_barber_id and active for update;
  if not found then raise exception using errcode='P0002',message='active barber not found'; end if;
  if not exists(select 1 from public.financial_accounts where organization_id=p_organization_id and id=p_financial_account_id and active) then
    raise exception using errcode='22023',message='active financial account is required'; end if;
  select settlement.id into v_settlement_id from public.commission_payout_settlements settlement
    where settlement.organization_id=p_organization_id and settlement.idempotency_key=p_idempotency_key;
  if v_settlement_id is not null then return v_settlement_id; end if;
  select count(*)::integer into v_selected_count from public.commission_service_details detail
    where detail.organization_id=p_organization_id and detail.barber_id=p_barber_id
      and detail.service_date between p_period_start and p_period_end
      and coalesce(detail.appointment_item_id,detail.internal_service_id)=any(v_selected_ids)
      and detail.payable_commission_cents>0;
  if v_selected_count<>cardinality(v_selected_ids) then raise exception using errcode='22023',message='selected commission is not open in the requested period'; end if;
  if exists(select 1 from public.commission_payout_items payout_item
    join public.commission_payouts payout on payout.organization_id=payout_item.organization_id and payout.id=payout_item.payout_id and payout.status='OPEN'
    join public.commission_ledger ledger on ledger.organization_id=payout_item.organization_id and ledger.id=payout_item.ledger_entry_id
    where payout_item.organization_id=p_organization_id and payout.barber_id=p_barber_id
      and (ledger.project_internal_service_id=any(v_selected_ids) or ledger.appointment_item_id=any(v_selected_ids) or ledger.subscription_session_id=any(v_selected_ids))) then
    raise exception using errcode='22023',message='selected commission is already reserved for payment'; end if;
  insert into public.commission_payouts(organization_id,barber_id,period_start,period_end,amount_cents)
    values(p_organization_id,p_barber_id,p_period_start,p_period_end,0) returning * into v_payout;
  for v_ledger in select ledger.* from public.commission_ledger ledger
    join public.commission_service_details detail on detail.organization_id=ledger.organization_id and (
      (ledger.project_internal_service_id is not null and detail.internal_service_id=ledger.project_internal_service_id)
      or (ledger.subscription_session_id is not null and detail.internal_service_id=ledger.subscription_session_id)
      or (ledger.project_internal_service_id is null and ledger.subscription_session_id is null
        and detail.appointment_id=ledger.appointment_id and detail.appointment_item_id=ledger.appointment_item_id))
    where ledger.organization_id=p_organization_id and ledger.barber_id=p_barber_id
      and coalesce(ledger.appointment_item_id,ledger.project_internal_service_id,ledger.subscription_session_id)=any(v_selected_ids)
      and detail.service_date between p_period_start and p_period_end
    order by coalesce(ledger.appointment_item_id,ledger.project_internal_service_id,ledger.subscription_session_id),ledger.created_at,ledger.id for update of ledger
  loop
    insert into public.commission_payout_items(organization_id,payout_id,ledger_entry_id) values(p_organization_id,v_payout.id,v_ledger.id);
    v_amount:=v_amount+v_ledger.amount_cents;
  end loop;
  if v_amount<=0 then raise exception using errcode='22023',message='no positive unpaid commission in selection'; end if;
  update public.commission_payouts set amount_cents=v_amount where organization_id=p_organization_id and id=v_payout.id;
  insert into public.commission_payout_settlements(organization_id,payout_id,financial_account_id,amount_cents,paid_on,launch_on,due_on,document_number,tags,payment_method,reference,idempotency_key,created_by)
    values(p_organization_id,v_payout.id,p_financial_account_id,v_amount,current_date,p_launch_on,p_due_on,
      nullif(btrim(p_document_number),''),nullif(btrim(p_tags),''),p_payment_method,nullif(btrim(p_reference),''),p_idempotency_key,auth.uid()) returning id into v_settlement_id;
  update public.commission_payouts set status='PAID',paid_at=now(),marked_paid_by=auth.uid() where organization_id=p_organization_id and id=v_payout.id;
  return v_settlement_id;
exception when unique_violation then
  select settlement.id into v_settlement_id from public.commission_payout_settlements settlement
    where settlement.organization_id=p_organization_id and settlement.idempotency_key=p_idempotency_key;
  if v_settlement_id is not null then return v_settlement_id; end if; raise;
end $$;
revoke all on function public.pay_commission(uuid,uuid,date,date,uuid[],date,date,uuid,public.financial_payment_method,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.pay_commission(uuid,uuid,date,date,uuid[],date,date,uuid,public.financial_payment_method,text,text,text,text) to authenticated;
