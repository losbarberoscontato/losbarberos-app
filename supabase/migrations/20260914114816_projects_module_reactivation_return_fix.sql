-- Fix composite return assignment during module reactivation.
-- SELECT function(...) INTO rowtype treats the composite value as one scalar
-- and attempts to cast its textual representation into the first UUID field.
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
