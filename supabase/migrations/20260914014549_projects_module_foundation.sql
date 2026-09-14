-- Projetos: módulo opcional e base de retenção para os dados da futura sub-tela.
-- O módulo inicia habilitado apenas para organizações cujo proprietário é
-- julioheidenn@gmail.com. A cobrança segue o mesmo ciclo do Stripe usado pelos
-- demais módulos: ADD/REMOVE fica pendente para o próximo ciclo.

insert into public.platform_modules(key, name, description)
values (
  'projects',
  'Projetos',
  'Acompanhe projetos da barbearia em um relatório dedicado.'
)
on conflict (key) do update
  set name = excluded.name,
      description = excluded.description,
      active = true,
      updated_at = now();

insert into public.platform_module_contract_versions(module_key, version, body, active)
values (
  'projects',
  'v1',
  'As cobranças do módulo Projetos são responsabilidade do gestor da barbearia. O sistema não transaciona valores nem realiza cobranças dos clientes. O módulo de pagamentos online ainda não está ativo e será disponibilizado futuramente.',
  true
)
on conflict (module_key, version) do update
  set body = excluded.body,
      active = excluded.active;

alter table public.organization_module_entitlements
  add column if not exists data_retention_until timestamptz,
  add column if not exists data_retention_status text not null default 'NONE'
    check (data_retention_status in ('NONE', 'PENDING_DELETION', 'RESTORED', 'DELETED'));

-- O proprietário informado recebe o módulo habilitado no primeiro provisionamento.
-- O upsert é idempotente e não reativa uma organização que já tenha sido
-- explicitamente desativada.
insert into public.organization_module_contract_acceptances(
  organization_id, module_key, contract_version, accepted_by, metadata
)
select m.organization_id, 'projects', 'v1', u.id, jsonb_build_object('source', 'DEFAULT_OWNER')
  from public.organization_memberships m
  join auth.users u on u.id = m.user_id
 where m.role = 'OWNER'
   and m.active
   and lower(u.email) = 'julioheidenn@gmail.com'
on conflict (organization_id, module_key, contract_version) do nothing;

insert into public.organization_module_entitlements(
  organization_id, module_key, enabled, changed_by, changed_at,
  module_contract_version, contract_accepted_at, contract_accepted_by,
  billing_change_effective_at, billing_change_action, billing_sync_status, data_retention_status
)
select m.organization_id, 'projects', true, u.id, now(), 'v1', now(), u.id,
       s.current_period_ends_at, 'ADD', 'PENDING', 'NONE'
  from public.organization_memberships m
  join auth.users u on u.id = m.user_id
  left join public.saas_subscriptions s on s.organization_id = m.organization_id
 where m.role = 'OWNER'
   and m.active
   and lower(u.email) = 'julioheidenn@gmail.com'
on conflict (organization_id, module_key) do nothing;

create or replace function public.set_organization_module_enabled(
  p_organization_id uuid,
  p_module_key text,
  p_enabled boolean
)
returns public.organization_module_entitlements
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_old boolean;
  v_changed_at timestamptz;
  v_existing_retention_until timestamptz;
  v_existing_retention_status text;
  v_row public.organization_module_entitlements;
  v_period_end timestamptz;
  v_action text;
  v_retention_until timestamptz;
  v_retention_status text;
begin
  if not (public.is_organization_owner(p_organization_id) or public.is_platform_admin()) then
    raise exception using errcode = '42501', message = 'module entitlement denied';
  end if;
  if not exists (select 1 from public.platform_modules where key = p_module_key and active) then
    raise exception using errcode = '22023', message = 'unknown or inactive module';
  end if;
  select enabled, changed_at, data_retention_until, data_retention_status
    into v_old, v_changed_at, v_existing_retention_until, v_existing_retention_status
    from public.organization_module_entitlements
   where organization_id = p_organization_id and module_key = p_module_key
   for update;
  if p_enabled and v_old is distinct from true and not exists (
    select 1
      from public.organization_module_contract_acceptances a
      join public.platform_module_contract_versions v
        on v.module_key = a.module_key and v.version = a.contract_version and v.active
     where a.organization_id = p_organization_id
       and a.module_key = p_module_key
       and a.accepted_at >= coalesce(v_changed_at, '-infinity'::timestamptz)
  ) then
    raise exception using errcode = '42501', message = 'module contract acceptance required';
  end if;
  select current_period_ends_at into v_period_end
    from public.saas_subscriptions
   where organization_id = p_organization_id;
  v_action := case
    when v_old is not distinct from p_enabled then 'NONE'
    when p_enabled then 'ADD'
    else 'REMOVE'
  end;
  v_retention_until := case
    when p_module_key = 'projects' and not p_enabled and v_old is distinct from false
      then now() + interval '60 days'
    when p_module_key = 'projects' and p_enabled and v_old is distinct from true
      then null
    else v_existing_retention_until
  end;
  v_retention_status := case
    when p_module_key <> 'projects' then coalesce(v_existing_retention_status, 'NONE')
    when not p_enabled and v_old is distinct from false then 'PENDING_DELETION'
    when p_enabled and v_old is distinct from true and v_existing_retention_until > now() then 'RESTORED'
    when p_enabled and v_old is distinct from true then 'NONE'
    else coalesce(v_existing_retention_status, 'NONE')
  end;
  insert into public.organization_module_entitlements(
    organization_id, module_key, enabled, changed_by,
    billing_change_effective_at, billing_change_action, billing_sync_status,
    data_retention_until, data_retention_status
  ) values (
    p_organization_id, p_module_key, p_enabled, auth.uid(),
    case when v_action = 'NONE' then null else v_period_end end,
    v_action,
    case when v_action = 'NONE' then 'NOT_CONFIGURED' else 'PENDING' end,
    v_retention_until,
    v_retention_status
  )
  on conflict (organization_id, module_key) do update set
    enabled = excluded.enabled,
    changed_by = excluded.changed_by,
    changed_at = now(),
    billing_change_effective_at = excluded.billing_change_effective_at,
    billing_change_action = excluded.billing_change_action,
    billing_sync_status = excluded.billing_sync_status,
    data_retention_until = excluded.data_retention_until,
    data_retention_status = excluded.data_retention_status
  returning * into v_row;
  if v_old is distinct from p_enabled then
    insert into public.organization_module_events(
      organization_id, module_key, from_enabled, to_enabled, actor_user_id, reason
    ) values (
      p_organization_id, p_module_key, v_old, p_enabled, auth.uid(),
      case when p_enabled then 'MANAGER_ENABLE_WITH_CONTRACT' else 'MANAGER_DISABLE' end
    );
  end if;
  return v_row;
end;
$$;

create or replace function public.accept_module_contract_and_enable(
  p_organization_id uuid,
  p_module_key text,
  p_contract_version text,
  p_metadata jsonb default '{}'::jsonb
)
returns public.organization_module_entitlements
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_row public.organization_module_entitlements;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'module contract acceptance denied';
  end if;
  if not exists (
    select 1 from public.platform_module_contract_versions
     where module_key = p_module_key and version = p_contract_version and active
  ) then
    raise exception using errcode = '22023', message = 'module contract version unavailable';
  end if;
  insert into public.organization_module_contract_acceptances(
    organization_id, module_key, contract_version, accepted_by, metadata
  ) values (
    p_organization_id, p_module_key, p_contract_version, auth.uid(), coalesce(p_metadata, '{}'::jsonb)
  ) on conflict (organization_id, module_key, contract_version) do update set
    accepted_by = excluded.accepted_by,
    accepted_at = now(),
    metadata = excluded.metadata;
  v_row := public.set_organization_module_enabled(p_organization_id, p_module_key, true);
  update public.organization_module_entitlements
     set module_contract_version = p_contract_version,
         contract_accepted_at = now(),
         contract_accepted_by = auth.uid()
   where organization_id = p_organization_id and module_key = p_module_key
   returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.accept_subscription_module_contract_and_enable(
  p_organization_id uuid,
  p_contract_version text,
  p_metadata jsonb default '{}'::jsonb
)
returns public.organization_module_entitlements
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  return public.accept_module_contract_and_enable(
    p_organization_id, 'subscription_plans', p_contract_version, p_metadata
  );
end;
$$;

revoke all on function public.accept_module_contract_and_enable(uuid,text,text,jsonb) from public, anon;
grant execute on function public.accept_module_contract_and_enable(uuid,text,text,jsonb) to authenticated;
revoke all on function public.accept_subscription_module_contract_and_enable(uuid,text,jsonb) from public, anon;
grant execute on function public.accept_subscription_module_contract_and_enable(uuid,text,jsonb) to authenticated;

-- O job é chamado pelo scheduler de manutenção com service_role. As tabelas de
-- dados de Projetos serão adicionadas na próxima etapa; esta função fecha a
-- janela de restauração de 60 dias e deixa o entitlement marcado como DELETED.
create or replace function public.process_expired_project_module_retention(p_limit integer default 100)
returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  perform public.require_service_role();
  for v_row in
    select organization_id
      from public.organization_module_entitlements
     where module_key = 'projects'
       and enabled = false
       and data_retention_status = 'PENDING_DELETION'
       and data_retention_until <= now()
     order by data_retention_until
     limit greatest(1, least(p_limit, 500))
     for update skip locked
  loop
    update public.organization_module_entitlements
       set data_retention_status = 'DELETED',
           data_retention_until = null,
           changed_at = now()
     where organization_id = v_row.organization_id and module_key = 'projects';
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.process_expired_project_module_retention(integer) from public, anon, authenticated;
grant execute on function public.process_expired_project_module_retention(integer) to service_role;

-- Executa diariamente depois do job de retenção geral.
select cron.schedule(
  'los_barberos_process_project_module_retention',
  '45 6 * * *',
  $job$select public.process_expired_project_module_retention(200);$job$
)
where not exists (
  select 1 from cron.job where jobname = 'los_barberos_process_project_module_retention'
);
