-- Kanban Geral: setores compartilhados pelos quadros de todos os projetos.
create table public.project_kanban_sectors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  position integer not null default 1 check (position > 0),
  responsible_barber_id uuid not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, name),
  foreign key (responsible_barber_id, organization_id)
    references public.barbers(id, organization_id) on delete restrict
);

create unique index project_kanban_sectors_active_name_key
  on public.project_kanban_sectors (organization_id, lower(btrim(name))) where active;
create index project_kanban_sectors_order_idx
  on public.project_kanban_sectors (organization_id, active, position, created_at);

alter table public.project_kanban_sectors enable row level security;
alter table public.project_kanban_sectors force row level security;
create policy project_kanban_sectors_owner_all on public.project_kanban_sectors
  for all to authenticated
  using (public.is_organization_owner(organization_id))
  with check (public.is_organization_owner(organization_id));
grant select, insert, update, delete on public.project_kanban_sectors to authenticated;

-- Cada quadro de projeto aponta para o setor compartilhado exibido no Kanban Geral.
alter table public.project_kanban_boards add column if not exists sector_id uuid;
alter table public.project_kanban_boards
  add constraint project_kanban_boards_sector_fk
  foreign key (sector_id, organization_id)
  references public.project_kanban_sectors(id, organization_id)
  on delete restrict;

insert into public.project_kanban_sectors (organization_id, name, position, responsible_barber_id)
select grouped.organization_id,
       grouped.name,
       row_number() over (partition by grouped.organization_id order by lower(grouped.name), grouped.first_position),
       grouped.responsible_barber_id
from (
  select b.organization_id,
         min(btrim(b.name)) as name,
         min(b.position) as first_position,
         (array_agg(b.responsible_barber_id order by b.position, b.created_at))[1] as responsible_barber_id
    from public.project_kanban_boards b
   where b.active and b.responsible_barber_id is not null
   group by b.organization_id, lower(btrim(b.name))
) grouped
on conflict (organization_id, name) do nothing;

update public.project_kanban_boards b
   set sector_id = s.id,
       updated_at = now()
  from public.project_kanban_sectors s
 where s.organization_id = b.organization_id
   and lower(btrim(s.name)) = lower(btrim(b.name))
   and b.sector_id is null;

create index project_kanban_boards_sector_idx
  on public.project_kanban_boards (organization_id, project_id, sector_id, active, position);

do $$
begin
  if exists (select 1 from public.project_kanban_boards where sector_id is null) then
    raise exception using errcode = '23502', message = 'every project kanban board requires a general kanban sector';
  end if;
end;
$$;

create or replace function public.ensure_project_kanban_board_sector()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_sector public.project_kanban_sectors;
  v_barber uuid;
begin
  if new.sector_id is not null then return new; end if;
  select * into v_sector
    from public.project_kanban_sectors
   where organization_id = new.organization_id and active
   order by position, created_at
   limit 1;
  if v_sector.id is null then
    select id into v_barber from public.barbers where organization_id = new.organization_id and active order by id limit 1;
    if v_barber is null then raise exception using errcode = '23514', message = 'organization requires an active barber before creating kanban sectors'; end if;
    insert into public.project_kanban_sectors (organization_id, name, position, responsible_barber_id)
    values (new.organization_id, 'Geral', 1, v_barber)
    on conflict (organization_id, name) do update set active = true
    returning * into v_sector;
  end if;
  new.sector_id := v_sector.id;
  return new;
end;
$$;

drop trigger if exists project_kanban_boards_assign_sector on public.project_kanban_boards;
create trigger project_kanban_boards_assign_sector
before insert or update of sector_id on public.project_kanban_boards
for each row execute function public.ensure_project_kanban_board_sector();

create or replace function public.upsert_project_kanban_sector(
  p_organization_id uuid,
  p_id uuid,
  p_name text,
  p_position integer default null,
  p_responsible_barber_id uuid default null
) returns public.project_kanban_sectors
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_sector public.project_kanban_sectors;
  v_position integer;
begin
  if not public.is_organization_owner(p_organization_id) then raise exception using errcode = '42501', message = 'kanban sector access denied'; end if;
  if not public.organization_module_enabled(p_organization_id, 'projects') then raise exception using errcode = '42501', message = 'projects module disabled'; end if;
  if char_length(btrim(coalesce(p_name, ''))) < 2 or char_length(btrim(p_name)) > 80 then raise exception using errcode = '22023', message = 'kanban sector name must contain 2 to 80 characters'; end if;
  if p_responsible_barber_id is null or not exists (select 1 from public.barbers where id = p_responsible_barber_id and organization_id = p_organization_id and active) then raise exception using errcode = '22023', message = 'kanban sector requires an active responsible barber'; end if;
  if p_id is null then
    select coalesce(max(position), 0) + 1 into v_position from public.project_kanban_sectors where organization_id = p_organization_id and active;
    insert into public.project_kanban_sectors (organization_id, name, position, responsible_barber_id)
    values (p_organization_id, btrim(p_name), coalesce(p_position, v_position), p_responsible_barber_id)
    returning * into v_sector;
  else
    update public.project_kanban_sectors
       set name = btrim(p_name), position = coalesce(p_position, position), responsible_barber_id = p_responsible_barber_id, updated_at = now()
     where id = p_id and organization_id = p_organization_id and active
     returning * into v_sector;
    if not found then raise exception using errcode = 'P0002', message = 'kanban sector not found'; end if;
  end if;
  return v_sector;
end;
$$;
revoke all on function public.upsert_project_kanban_sector(uuid, uuid, text, integer, uuid) from public, anon;
grant execute on function public.upsert_project_kanban_sector(uuid, uuid, text, integer, uuid) to authenticated;

create or replace function public.upsert_project_kanban_board_with_sector(
  p_organization_id uuid,
  p_project_id uuid,
  p_id uuid,
  p_name text,
  p_position integer default null,
  p_responsible_barber_id uuid default null,
  p_sector_id uuid default null
) returns public.project_kanban_boards
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_board public.project_kanban_boards;
begin
  if not public.is_organization_owner(p_organization_id) then raise exception using errcode = '42501', message = 'kanban board access denied'; end if;
  if not public.organization_module_enabled(p_organization_id, 'projects') then raise exception using errcode = '42501', message = 'projects module disabled'; end if;
  if p_sector_id is null or not exists (select 1 from public.project_kanban_sectors where id = p_sector_id and organization_id = p_organization_id and active) then raise exception using errcode = '22023', message = 'kanban board requires a valid general kanban sector'; end if;
  select * into v_board from public.upsert_project_kanban_board(p_organization_id, p_project_id, p_id, p_name, p_position, p_responsible_barber_id);
  update public.project_kanban_boards set sector_id = p_sector_id, updated_at = now() where id = v_board.id and organization_id = p_organization_id returning * into v_board;
  return v_board;
end;
$$;
revoke all on function public.upsert_project_kanban_board_with_sector(uuid, uuid, uuid, text, integer, uuid, uuid) from public, anon;
grant execute on function public.upsert_project_kanban_board_with_sector(uuid, uuid, uuid, text, integer, uuid, uuid) to authenticated;

create or replace function public.move_project_engagement_to_kanban_sector(
  p_organization_id uuid,
  p_project_id uuid,
  p_engagement_id uuid,
  p_destination_sector_id uuid
) returns public.project_engagements
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_engagement public.project_engagements;
  v_board public.project_kanban_boards;
begin
  if not public.is_organization_owner(p_organization_id) then raise exception using errcode = '42501', message = 'kanban engagement access denied'; end if;
  if not public.organization_module_enabled(p_organization_id, 'projects') then raise exception using errcode = '42501', message = 'projects module disabled'; end if;
  if not exists (select 1 from public.project_kanban_sectors where id = p_destination_sector_id and organization_id = p_organization_id and active) then raise exception using errcode = '22023', message = 'destination kanban sector is invalid'; end if;
  select * into v_engagement from public.project_engagements where id = p_engagement_id and organization_id = p_organization_id and project_id = p_project_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'project engagement not found'; end if;
  select * into v_board from public.project_kanban_boards where project_id = p_project_id and organization_id = p_organization_id and sector_id = p_destination_sector_id and active order by position, created_at limit 1;
  if not found then raise exception using errcode = '22023', message = 'destination sector has no board in this project'; end if;
  update public.project_engagements set kanban_board_id = v_board.id, updated_at = now() where id = v_engagement.id and organization_id = p_organization_id returning * into v_engagement;
  return v_engagement;
end;
$$;
revoke all on function public.move_project_engagement_to_kanban_sector(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.move_project_engagement_to_kanban_sector(uuid, uuid, uuid, uuid) to authenticated;
