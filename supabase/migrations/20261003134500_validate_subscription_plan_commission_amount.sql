-- Reject missing or inconsistent catalog commission values with a clear
-- validation error before they reach the table check constraint. The UI's
-- percentage_value is a compatibility fallback; basis points remain canonical.
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
        if v_enabled then
          insert into public.barber_services(organization_id,barber_id,service_id,active)
          select distinct p_organization_id,p_barber_id,item.service_id,true
          from public.subscription_plans plan
          join lateral (select version.id from public.subscription_plan_versions version
            where version.organization_id=plan.organization_id and version.plan_id=plan.id
            order by version.version desc limit 1) latest on true
          join public.subscription_plan_services item
            on item.organization_id=plan.organization_id and item.plan_version_id=latest.id
          where plan.organization_id=p_organization_id and plan.id=v_target
          on conflict(barber_id,service_id) do update set active=true;
        end if;
        insert into public.barber_subscription_plans(organization_id,barber_id,plan_id,active)
        values(p_organization_id,p_barber_id,v_target,v_enabled)
        on conflict(barber_id,plan_id) do update set active=excluded.active;
      end if;

      if not v_enabled then
        perform public.replace_catalog_commission_rule(p_organization_id,p_barber_id,v_kind,v_target,false,'PERCENT',null,null,now(),null);
      elsif nullif(btrim(v_item->>'value_present'),'')='true' then
        v_mode := (v_item->>'mode')::public.commission_mode;
        v_percentage := nullif(v_item->>'percentage_bps','')::integer;
        if v_mode='PERCENT' and v_percentage is null then
          v_percentage := round(nullif(v_item->>'percentage_value','')::numeric * 100)::integer;
        end if;
        v_fixed := nullif(v_item->>'fixed_cents','')::bigint;

        if v_mode='PERCENT' and (v_percentage is null or v_percentage not between 0 and 10000 or v_fixed is not null) then
          raise exception using errcode='22023',message='invalid percentage commission amount';
        elsif v_mode='FIXED' and (v_fixed is null or v_fixed<0 or v_percentage is not null) then
          raise exception using errcode='22023',message='invalid fixed commission amount';
        end if;
        perform public.replace_catalog_commission_rule(p_organization_id,p_barber_id,v_kind,v_target,true,v_mode,v_percentage,v_fixed,now(),null);
      end if;
    end loop;
  end loop;
end $$;

revoke all on function public.save_barber_catalog_commissions(uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.save_barber_catalog_commissions(uuid,uuid,jsonb,jsonb) to authenticated;
