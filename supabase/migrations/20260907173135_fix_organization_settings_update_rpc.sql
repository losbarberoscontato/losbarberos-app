-- Atualização explícita das configurações editáveis pelo proprietário.
-- Evita que o formulário dependa de um UPDATE amplo no browser, que pode
-- retornar uma mensagem genérica de RLS mesmo quando a tela foi autorizada.
create or replace function public.update_organization_settings(
  p_organization_id uuid,
  p_name text,
  p_slug text,
  p_public_contact_phone_e164 text default null,
  p_logo_path text default null
)
returns public.organizations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_organization public.organizations;
  v_name text := nullif(trim(p_name), '');
  v_slug text := lower(nullif(trim(p_slug), ''));
  v_phone text := nullif(trim(p_public_contact_phone_e164), '');
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization owner required';
  end if;

  if v_name is null or length(v_name) < 2 then
    raise exception using errcode = '22023', message = 'organization name is invalid';
  end if;
  if v_slug is null or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception using errcode = '22023', message = 'organization slug is invalid';
  end if;
  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception using errcode = '22023', message = 'public contact phone must be E.164';
  end if;

  update public.organizations
  set name = v_name,
      slug = v_slug,
      public_contact_phone_e164 = v_phone,
      logo_path = nullif(trim(p_logo_path), '')
  where id = p_organization_id
  returning * into v_organization;

  if not found then
    raise exception using errcode = 'P0002', message = 'organization not found';
  end if;
  return v_organization;
end;
$$;

revoke all on function public.update_organization_settings(uuid, text, text, text, text) from public, anon;
grant execute on function public.update_organization_settings(uuid, text, text, text, text) to authenticated;
