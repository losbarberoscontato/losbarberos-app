-- Acesso individual do profissional ao núcleo operacional de Projetos.
alter table public.barbers
  add column if not exists projects_access_enabled boolean not null default false;

drop function if exists public.get_my_barber_app_context(text);
create function public.get_my_barber_app_context(p_organization_slug text default null)
returns table (
  organization_id uuid, organization_name text, organization_slug text, organization_logo_path text,
  timezone text, barber_id uuid, barber_name text, barber_avatar_url text, barber_bio text,
  barber_whatsapp_e164 text, agenda_access_scope public.barber_agenda_access_scope,
  cash_access_enabled boolean, projects_access_enabled boolean
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
    b.whatsapp_e164, b.agenda_access_scope, b.cash_access_enabled, b.projects_access_enabled
  from public.barbers b join public.organizations o on o.id = b.organization_id
  where b.auth_user_id = auth.uid() and b.active and b.app_access_enabled
    and (p_organization_slug is null or o.slug = p_organization_slug)
  order by o.name;
end;
$$;

create table public.project_barbers (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  barber_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  primary key (project_id, barber_id),
  unique (project_id, organization_id, barber_id),
  foreign key (project_id, organization_id) references public.projects(id, organization_id) on delete cascade,
  foreign key (barber_id, organization_id) references public.barbers(id, organization_id) on delete cascade
);

create index project_barbers_barber_idx on public.project_barbers (organization_id, barber_id, project_id);
alter table public.project_barbers enable row level security;
alter table public.project_barbers force row level security;

create or replace function public.is_barber_project_member(
  p_organization_id uuid, p_project_id uuid, p_user_id uuid default auth.uid()
)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
      from public.project_barbers pb
      join public.barbers b on b.id = pb.barber_id and b.organization_id = pb.organization_id
     where pb.organization_id = p_organization_id
       and pb.project_id = p_project_id
       and b.auth_user_id = p_user_id
       and b.active and b.app_access_enabled and b.projects_access_enabled
  );
$$;

create policy project_barbers_owner_all on public.project_barbers
  for all to authenticated
  using (public.is_organization_owner(organization_id))
  with check (public.is_organization_owner(organization_id));
create policy project_barbers_member_select on public.project_barbers
  for select to authenticated
  using (exists (
    select 1 from public.barbers b
     where b.id = barber_id and b.organization_id = project_barbers.organization_id
       and b.auth_user_id = auth.uid() and b.active and b.app_access_enabled and b.projects_access_enabled
  ));

create policy projects_member_select on public.projects
  for select to authenticated
  using (public.is_barber_project_member(organization_id, id));
create policy project_packages_member_select on public.project_packages
  for select to authenticated
  using (public.is_barber_project_member(organization_id, project_id));
create policy project_kanban_boards_member_select on public.project_kanban_boards
  for select to authenticated
  using (public.is_barber_project_member(organization_id, project_id));
create policy project_kanban_sectors_member_select on public.project_kanban_sectors
  for select to authenticated
  using (exists (
    select 1 from public.project_kanban_boards b
     where b.sector_id = project_kanban_sectors.id
       and b.organization_id = project_kanban_sectors.organization_id
       and public.is_barber_project_member(b.organization_id, b.project_id)
  ));
create policy project_engagements_member_select on public.project_engagements
  for select to authenticated
  using (public.is_barber_project_member(organization_id, project_id));
create policy project_engagement_comments_member_select on public.project_engagement_comments
  for select to authenticated
  using (public.is_barber_project_member(organization_id, project_id));
create policy project_internal_cards_member_select on public.project_kanban_internal_cards
  for select to authenticated
  using (public.is_barber_project_member(organization_id, project_id));
create policy project_internal_services_member_select on public.project_engagement_internal_services
  for select to authenticated
  using (public.is_barber_project_member(organization_id, project_id));
create policy project_package_assignments_member_select on public.project_package_service_assignments
  for select to authenticated
  using (exists (
    select 1 from public.project_packages p
     where p.id = project_package_id and p.organization_id = project_package_service_assignments.organization_id
       and public.is_barber_project_member(p.organization_id, p.project_id)
  ));
create policy project_customers_member_select on public.customers
  for select to authenticated
  using (exists (
    select 1 from public.project_engagements e
     where e.customer_id = customers.id and e.organization_id = customers.organization_id
       and public.is_barber_project_member(e.organization_id, e.project_id)
  ));

grant select on public.project_barbers to authenticated;

create table public.project_engagement_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  engagement_id uuid not null,
  label text not null default 'Link',
  url text not null,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (project_id, organization_id) references public.projects(id, organization_id) on delete cascade,
  foreign key (engagement_id, organization_id) references public.project_engagements(id, organization_id) on delete cascade
);
create index project_engagement_links_engagement_idx on public.project_engagement_links (organization_id, engagement_id, created_at);
alter table public.project_engagement_links enable row level security;
alter table public.project_engagement_links force row level security;
create policy project_engagement_links_member_select on public.project_engagement_links for select to authenticated
  using (public.is_barber_project_member(organization_id, project_id));
grant select on public.project_engagement_links to authenticated;

create or replace function public.barber_add_project_engagement_link(
  p_organization_id uuid, p_project_id uuid, p_engagement_id uuid, p_label text, p_url text
)
returns public.project_engagement_links language plpgsql security definer set search_path = public, pg_temp as $$
declare v_link public.project_engagement_links;
begin
  if not public.is_barber_project_member(p_organization_id, p_project_id) then raise exception using errcode='42501', message='project access denied'; end if;
  if p_url is null or p_url !~* '^https?://' then raise exception using errcode='22023', message='link must use http or https'; end if;
  insert into public.project_engagement_links (organization_id, project_id, engagement_id, label, url)
  select p_organization_id, p_project_id, p_engagement_id, coalesce(nullif(btrim(p_label), ''), 'Link'), btrim(p_url)
  where exists (select 1 from public.project_engagements e where e.id=p_engagement_id and e.organization_id=p_organization_id and e.project_id=p_project_id)
  returning * into v_link;
  if v_link.id is null then raise exception using errcode='22023', message='engagement not found'; end if;
  return v_link;
end;
$$;

create or replace function public.barber_delete_project_engagement_link(
  p_organization_id uuid, p_link_id uuid
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.project_engagement_links where id=p_link_id and organization_id=p_organization_id and created_by=auth.uid();
  if not found then raise exception using errcode='42501', message='only the author can delete this link'; end if;
end;
$$;

create or replace function public.barber_add_project_engagement_comment(
  p_organization_id uuid, p_project_id uuid, p_engagement_id uuid, p_body text
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_name text;
begin
  if not public.is_barber_project_member(p_organization_id, p_project_id) then raise exception using errcode='42501', message='project access denied'; end if;
  select b.display_name into v_name from public.barbers b where b.organization_id=p_organization_id and b.auth_user_id=auth.uid() and b.active limit 1;
  insert into public.project_engagement_comments (organization_id, project_id, engagement_id, body, created_by, author_name)
  select p_organization_id, p_project_id, p_engagement_id, btrim(p_body), auth.uid(), coalesce(v_name, 'Profissional')
  where length(btrim(coalesce(p_body, ''))) > 0
    and exists (select 1 from public.project_engagements e where e.id=p_engagement_id and e.organization_id=p_organization_id and e.project_id=p_project_id);
end;
$$;

create or replace function public.barber_set_project_internal_service_delivery(
  p_organization_id uuid, p_project_id uuid, p_internal_service_id uuid, p_delivery_on date
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_barber_project_member(p_organization_id, p_project_id) then raise exception using errcode='42501', message='project access denied'; end if;
  update public.project_engagement_internal_services s
     set delivery_on=p_delivery_on, status='COMPLETED'
   where s.id=p_internal_service_id and s.organization_id=p_organization_id and s.project_id=p_project_id
     and s.barber_id=(select b.id from public.barbers b where b.organization_id=p_organization_id and b.auth_user_id=auth.uid() and b.active limit 1)
     and s.delivery_on is null and s.status='OPEN';
  if not found then raise exception using errcode='42501', message='service is not assigned or already delivered'; end if;
end;
$$;

create or replace function public.update_project(
  p_organization_id uuid, p_project_id uuid, p_name text, p_description text,
  p_starts_on date, p_sales_close_on date, p_ends_on date, p_goal_contracts integer
)
returns public.projects language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_project public.projects;
begin
  if not public.is_organization_owner(p_organization_id) then raise exception using errcode='42501', message='project update denied'; end if;
  update public.projects set name=btrim(p_name), description=nullif(btrim(p_description), ''), starts_on=p_starts_on,
    sales_close_on=p_sales_close_on, ends_on=p_ends_on, goal_contracts=p_goal_contracts, updated_at=now()
    where id=p_project_id and organization_id=p_organization_id returning * into v_project;
  if v_project.id is null then raise exception using errcode='22023', message='project not found'; end if;
  return v_project;
end;
$$;
grant select on public.projects, public.project_packages, public.project_kanban_boards,
  public.project_kanban_sectors, public.project_engagements, public.project_engagement_comments,
  public.project_kanban_internal_cards, public.project_engagement_internal_services,
  public.project_package_service_assignments, public.customers to authenticated;

create or replace function public.set_project_barbers(
  p_organization_id uuid, p_project_id uuid, p_barber_ids uuid[]
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'project professionals access denied';
  end if;
  if not exists (select 1 from public.projects where id = p_project_id and organization_id = p_organization_id) then
    raise exception using errcode = '22023', message = 'project not found';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_barber_ids, '{}'::uuid[])) id
     where not exists (select 1 from public.barbers b where b.id = id and b.organization_id = p_organization_id and b.active)
  ) then raise exception using errcode = '22023', message = 'professional must be active and tenant scoped'; end if;
  delete from public.project_barbers where organization_id = p_organization_id and project_id = p_project_id;
  insert into public.project_barbers (organization_id, project_id, barber_id)
  select p_organization_id, p_project_id, id from unnest(coalesce(p_barber_ids, '{}'::uuid[])) id;
end;
$$;

revoke all on function public.set_project_barbers(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.set_project_barbers(uuid, uuid, uuid[]) to authenticated;

create or replace function public.get_my_barber_project_context(p_organization_slug text default null)
returns table (
  project_id uuid, organization_id uuid, organization_name text, organization_slug text,
  name text, description text, status text, starts_on date, ends_on date
)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.organization_id, o.name, o.slug, p.name, p.description, p.status, p.starts_on, p.ends_on
    from public.project_barbers pb
    join public.projects p on p.id = pb.project_id and p.organization_id = pb.organization_id
    join public.barbers b on b.id = pb.barber_id and b.organization_id = pb.organization_id
    join public.organizations o on o.id = p.organization_id
   where b.auth_user_id = auth.uid() and b.active and b.app_access_enabled and b.projects_access_enabled
     and p.status = 'PUBLISHED' and (p_organization_slug is null or o.slug = p_organization_slug)
   order by p.created_at desc;
$$;

create or replace function public.barber_set_project_due_date(
  p_organization_id uuid, p_project_id uuid, p_engagement_id uuid, p_due_on date
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_barber_project_member(p_organization_id, p_project_id) then raise exception using errcode='42501', message='project access denied'; end if;
  update public.project_engagements
     set event_due_on = p_due_on, updated_at = now()
   where id = p_engagement_id and organization_id = p_organization_id and project_id = p_project_id and event_due_on is null;
  if not found then raise exception using errcode='42501', message='project due date already defined or engagement not found'; end if;
end;
$$;

create or replace function public.barber_update_project_engagement(
  p_organization_id uuid, p_project_id uuid, p_engagement_id uuid, p_description text
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_barber_project_member(p_organization_id, p_project_id) then raise exception using errcode='42501', message='project access denied'; end if;
  update public.project_engagements set event_description = nullif(btrim(p_description), ''), updated_at = now()
   where id = p_engagement_id and organization_id = p_organization_id and project_id = p_project_id;
end;
$$;

create or replace function public.barber_move_project_engagement(
  p_organization_id uuid, p_project_id uuid, p_engagement_id uuid, p_destination_board_id uuid
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_barber_project_member(p_organization_id, p_project_id) then raise exception using errcode='42501', message='project access denied'; end if;
  if exists (select 1 from public.project_engagement_internal_services s where s.organization_id=p_organization_id and s.engagement_id=p_engagement_id and s.status='OPEN') then
    raise exception using errcode='42501', message='engagement has an open internal service';
  end if;
  if not exists (select 1 from public.project_kanban_boards where id=p_destination_board_id and organization_id=p_organization_id and project_id=p_project_id and active) then
    raise exception using errcode='22023', message='destination board is invalid';
  end if;
  update public.project_engagements set kanban_board_id=p_destination_board_id, kanban_received_at=now(), kanban_received_by=auth.uid(), kanban_received_by_name='Profissional', updated_at=now()
   where id=p_engagement_id and organization_id=p_organization_id and project_id=p_project_id;
end;
$$;

revoke all on function public.get_my_barber_project_context(text), public.barber_set_project_due_date(uuid,uuid,uuid,date), public.barber_update_project_engagement(uuid,uuid,uuid,text), public.barber_move_project_engagement(uuid,uuid,uuid,uuid), public.barber_add_project_engagement_link(uuid,uuid,uuid,text,text), public.barber_delete_project_engagement_link(uuid,uuid), public.barber_add_project_engagement_comment(uuid,uuid,uuid,text), public.barber_set_project_internal_service_delivery(uuid,uuid,uuid,date), public.update_project(uuid,uuid,text,text,date,date,date,integer) from public, anon;
grant execute on function public.get_my_barber_project_context(text), public.barber_set_project_due_date(uuid,uuid,uuid,date), public.barber_update_project_engagement(uuid,uuid,uuid,text), public.barber_move_project_engagement(uuid,uuid,uuid,uuid), public.barber_add_project_engagement_link(uuid,uuid,uuid,text,text), public.barber_delete_project_engagement_link(uuid,uuid), public.barber_add_project_engagement_comment(uuid,uuid,uuid,text), public.barber_set_project_internal_service_delivery(uuid,uuid,uuid,date), public.update_project(uuid,uuid,text,text,date,date,date,integer) to authenticated;
