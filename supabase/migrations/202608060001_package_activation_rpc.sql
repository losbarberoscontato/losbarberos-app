begin;

create or replace function public.set_package_active(
  p_organization_id uuid,
  p_package_id uuid,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization owner required';
  end if;
  if p_active and not public.organization_allows_management_mutations(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization access does not allow package reactivation';
  end if;
  update public.packages
  set active = coalesce(p_active, false)
  where id = p_package_id and organization_id = p_organization_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'tenant package not found';
  end if;
end;
$$;

revoke all on function public.set_package_active(uuid, uuid, boolean) from public;
grant execute on function public.set_package_active(uuid, uuid, boolean) to authenticated;

commit;
