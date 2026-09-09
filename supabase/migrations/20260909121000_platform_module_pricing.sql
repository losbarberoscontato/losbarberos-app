create or replace function public.set_platform_module_price(
  p_module_key text,
  p_monthly_price_cents bigint,
  p_effective_from date default current_date
)
returns public.platform_module_price_versions
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_price public.platform_module_price_versions;
begin
  if not public.is_platform_admin() then raise exception using errcode='42501', message='platform admin required'; end if;
  if p_monthly_price_cents < 0 then raise exception using errcode='22023', message='price must be non-negative'; end if;
  if not exists (select 1 from public.platform_modules where key=p_module_key and active) then raise exception using errcode='22023', message='module not found'; end if;
  update public.platform_module_price_versions set effective_until=p_effective_from - 1 where module_key=p_module_key and effective_until is null and effective_from < p_effective_from;
  insert into public.platform_module_price_versions(module_key,monthly_price_cents,effective_from,created_by) values(p_module_key,p_monthly_price_cents,p_effective_from,auth.uid()) returning * into v_price;
  return v_price;
end $$;

revoke all on function public.set_platform_module_price(text,bigint,date) from public, anon;
grant execute on function public.set_platform_module_price(text,bigint,date) to authenticated;
