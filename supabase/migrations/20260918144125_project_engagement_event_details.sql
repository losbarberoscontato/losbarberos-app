-- Detalhes operacionais do evento no Kanban e comentários do gestor.
alter table public.project_engagements
  add column if not exists event_description text,
  add column if not exists event_link_1 text,
  add column if not exists event_link_2 text,
  add column if not exists event_link_3 text;

create table public.project_engagement_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  engagement_id uuid not null,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_by uuid not null references auth.users(id),
  author_name text not null check (char_length(btrim(author_name)) between 1 and 160),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (engagement_id, organization_id)
    references public.project_engagements(id, organization_id) on delete cascade
);

create index project_engagement_comments_lookup_idx
  on public.project_engagement_comments (organization_id, engagement_id, created_at);

alter table public.project_engagement_comments enable row level security;
alter table public.project_engagement_comments force row level security;

create policy project_engagement_comments_owner_all
  on public.project_engagement_comments
  for all to authenticated
  using (public.is_organization_owner(organization_id))
  with check (public.is_organization_owner(organization_id));

grant select on public.project_engagement_comments to authenticated;

create or replace function public.save_project_engagement_event(
  p_organization_id uuid,
  p_project_id uuid,
  p_engagement_id uuid,
  p_description text,
  p_link_1 text,
  p_link_2 text,
  p_link_3 text
) returns public.project_engagements
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_engagement public.project_engagements;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'project event write denied';
  end if;
  if not public.organization_module_enabled(p_organization_id, 'projects') then
    raise exception using errcode = '42501', message = 'projects module disabled';
  end if;

  select * into v_engagement
    from public.project_engagements
   where id = p_engagement_id
     and organization_id = p_organization_id
     and project_id = p_project_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'project engagement not found';
  end if;

  update public.project_engagements
     set event_description = nullif(btrim(p_description), ''),
         event_link_1 = nullif(btrim(p_link_1), ''),
         event_link_2 = nullif(btrim(p_link_2), ''),
         event_link_3 = nullif(btrim(p_link_3), ''),
         updated_at = now()
   where id = v_engagement.id
     and organization_id = p_organization_id
   returning * into v_engagement;
  return v_engagement;
end;
$$;

revoke all on function public.save_project_engagement_event(uuid, uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.save_project_engagement_event(uuid, uuid, uuid, text, text, text, text) to authenticated;

create or replace function public.save_project_engagement_comment(
  p_organization_id uuid,
  p_project_id uuid,
  p_engagement_id uuid,
  p_comment_id uuid,
  p_body text
) returns public.project_engagement_comments
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_comment public.project_engagement_comments;
  v_author_name text;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'project comment write denied';
  end if;
  if not public.organization_module_enabled(p_organization_id, 'projects') then
    raise exception using errcode = '42501', message = 'projects module disabled';
  end if;
  if nullif(btrim(p_body), '') is null then
    raise exception using errcode = '22023', message = 'comment cannot be empty';
  end if;
  if char_length(btrim(p_body)) > 4000 then
    raise exception using errcode = '22023', message = 'comment is too long';
  end if;
  if not exists (
    select 1 from public.project_engagements e
     where e.id = p_engagement_id
       and e.organization_id = p_organization_id
       and e.project_id = p_project_id
  ) then
    raise exception using errcode = 'P0002', message = 'project engagement not found';
  end if;

  select coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(auth.jwt() ->> 'email'), ''), 'Usuário')
    into v_author_name
    from public.profiles p
   where p.id = auth.uid();
  v_author_name := coalesce(v_author_name, nullif(btrim(auth.jwt() ->> 'email'), ''), 'Usuário');

  if p_comment_id is null then
    insert into public.project_engagement_comments(
      organization_id, project_id, engagement_id, body, created_by, author_name
    ) values (
      p_organization_id, p_project_id, p_engagement_id, btrim(p_body), auth.uid(), v_author_name
    ) returning * into v_comment;
  else
    update public.project_engagement_comments
       set body = btrim(p_body), updated_at = now()
     where id = p_comment_id
       and organization_id = p_organization_id
       and project_id = p_project_id
       and engagement_id = p_engagement_id
     returning * into v_comment;
    if not found then
      raise exception using errcode = 'P0002', message = 'project comment not found';
    end if;
  end if;
  return v_comment;
end;
$$;

revoke all on function public.save_project_engagement_comment(uuid, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.save_project_engagement_comment(uuid, uuid, uuid, uuid, text) to authenticated;
