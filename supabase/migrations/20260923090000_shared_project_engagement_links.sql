alter table public.project_engagement_links
  add column if not exists created_by_role text not null default 'BARBER';

alter table public.project_engagement_links
  drop constraint if exists project_engagement_links_created_by_role_check;
alter table public.project_engagement_links
  add constraint project_engagement_links_created_by_role_check check (created_by_role in ('OWNER', 'BARBER'));

create or replace function public.owner_sync_project_engagement_links(
  p_organization_id uuid, p_project_id uuid, p_engagement_id uuid,
  p_titles text[], p_urls text[]
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare i integer;
begin
  if not public.is_organization_owner(p_organization_id) then raise exception using errcode='42501', message='project link write denied'; end if;
  if not exists (select 1 from public.project_engagements where id=p_engagement_id and organization_id=p_organization_id and project_id=p_project_id) then raise exception using errcode='P0002', message='engagement not found'; end if;
  delete from public.project_engagement_links where organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id and created_by_role='OWNER';
  for i in 1..least(coalesce(array_length(p_urls, 1), 0), 3) loop
    if nullif(btrim(p_urls[i]), '') is not null then
      if btrim(p_urls[i]) !~* '^https?://' then raise exception using errcode='22023', message='link must use http or https'; end if;
      insert into public.project_engagement_links (organization_id, project_id, engagement_id, label, url, created_by, created_by_role)
      values (p_organization_id, p_project_id, p_engagement_id, coalesce(nullif(btrim(p_titles[i]), ''), 'Link ' || i), btrim(p_urls[i]), auth.uid(), 'OWNER');
    end if;
  end loop;
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
  insert into public.project_engagement_links (organization_id, project_id, engagement_id, label, url, created_by, created_by_role)
  select p_organization_id, p_project_id, p_engagement_id, coalesce(nullif(btrim(p_label), ''), 'Link'), btrim(p_url), b.id, 'BARBER'
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
  delete from public.project_engagement_links where id=p_link_id and organization_id=p_organization_id and created_by_role='BARBER'
    and created_by=(select b.id from public.barbers b where b.organization_id=p_organization_id and b.auth_user_id=auth.uid() and b.active limit 1);
  if not found then raise exception using errcode='42501', message='only the author can delete this link'; end if;
end;
$$;

revoke all on function public.owner_sync_project_engagement_links(uuid,uuid,uuid,text[],text[]) from public, anon, authenticated, service_role;
grant execute on function public.owner_sync_project_engagement_links(uuid,uuid,uuid,text[],text[]) to authenticated;
