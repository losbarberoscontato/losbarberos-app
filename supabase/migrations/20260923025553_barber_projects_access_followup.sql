-- Expõe a identidade do profissional e garante que links só possam ser removidos
-- pelo próprio profissional que os criou.
drop function if exists public.get_my_barber_app_context(text);
create function public.get_my_barber_app_context(p_organization_slug text default null)
returns table (
  organization_id uuid, organization_name text, organization_slug text, organization_logo_path text,
  timezone text, barber_id uuid, barber_name text, barber_avatar_url text, barber_bio text,
  barber_whatsapp_e164 text, agenda_access_scope public.barber_agenda_access_scope,
  cash_access_enabled boolean, projects_access_enabled boolean, barber_auth_user_id uuid
)
language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare v_email text;
begin
  if auth.uid() is null then return; end if;
  select lower(email) into v_email from auth.users where id = auth.uid();
  if v_email is not null then
    update public.barbers b set auth_user_id = auth.uid(), updated_at = now()
    where b.auth_user_id is null and lower(b.login_email) = v_email and b.active and b.app_access_enabled
      and (p_organization_slug is null or exists (select 1 from public.organizations o where o.id = b.organization_id and o.slug = p_organization_slug));
  end if;
  return query
  select o.id, o.name, o.slug, o.logo_path, o.timezone, b.id, b.display_name, b.avatar_url, b.bio,
    b.whatsapp_e164, b.agenda_access_scope, b.cash_access_enabled, b.projects_access_enabled, b.auth_user_id
  from public.barbers b join public.organizations o on o.id = b.organization_id
  where b.auth_user_id = auth.uid() and b.active and b.app_access_enabled
    and (p_organization_slug is null or o.slug = p_organization_slug)
  order by o.name;
end;
$$;

create or replace function public.barber_add_project_engagement_link(
  p_organization_id uuid, p_project_id uuid, p_engagement_id uuid, p_label text, p_url text
)
returns public.project_engagement_links language plpgsql security definer set search_path = public, pg_temp as $$
declare v_link public.project_engagement_links;
begin
  if not public.is_barber_project_member(p_organization_id, p_project_id) then raise exception using errcode='42501', message='project access denied'; end if;
  if p_url is null or p_url !~* '^https?://' then raise exception using errcode='22023', message='link must use http or https'; end if;
  insert into public.project_engagement_links (organization_id, project_id, engagement_id, label, url, created_by)
  select p_organization_id, p_project_id, p_engagement_id, coalesce(nullif(btrim(p_label), ''), 'Link'), btrim(p_url), b.id
  from public.barbers b
  where b.organization_id=p_organization_id and b.auth_user_id=auth.uid() and b.active
    and exists (select 1 from public.project_engagements e where e.id=p_engagement_id and e.organization_id=p_organization_id and e.project_id=p_project_id)
  returning * into v_link;
  if v_link.id is null then raise exception using errcode='22023', message='engagement not found'; end if;
  return v_link;
end;
$$;

create or replace function public.barber_delete_project_engagement_link(p_organization_id uuid, p_link_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.project_engagement_links where id=p_link_id and organization_id=p_organization_id
    and created_by=(select b.id from public.barbers b where b.organization_id=p_organization_id and b.auth_user_id=auth.uid() and b.active limit 1);
  if not found then raise exception using errcode='42501', message='only the author can delete this link'; end if;
end;
$$;
