-- Quadros do Kanban são configuráveis por projeto. O status da contratação
-- continua representando o ciclo comercial; kanban_board_id representa apenas
-- a coluna operacional escolhida pelo gestor.
create table public.project_kanban_boards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  system_key text check (system_key is null or system_key in ('PROPOSAL', 'ACTIVE', 'COMPLETED', 'CANCELED')),
  position integer not null default 1 check (position > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade
);

create unique index project_kanban_boards_active_name_key
  on public.project_kanban_boards (project_id, lower(btrim(name))) where active;
create unique index project_kanban_boards_system_key
  on public.project_kanban_boards (project_id, system_key) where active and system_key is not null;
create index project_kanban_boards_project_order_idx
  on public.project_kanban_boards (organization_id, project_id, active, position, created_at);

alter table public.project_kanban_boards enable row level security;
alter table public.project_kanban_boards force row level security;
create policy project_kanban_boards_owner_all on public.project_kanban_boards
  for all to authenticated
  using (public.is_organization_owner(organization_id))
  with check (public.is_organization_owner(organization_id));
grant select, insert, update, delete on public.project_kanban_boards to authenticated;

alter table public.project_engagements add column kanban_board_id uuid;
alter table public.project_engagements
  add constraint project_engagements_kanban_board_fk
  foreign key (kanban_board_id, organization_id)
  references public.project_kanban_boards(id, organization_id)
  on delete restrict;
create index project_engagements_project_board_idx
  on public.project_engagements (organization_id, project_id, kanban_board_id, created_at desc);

insert into public.project_kanban_boards (organization_id, project_id, name, system_key, position)
select p.organization_id, p.id, seed.name, seed.system_key, seed.position
from public.projects p
cross join (values
  ('Aguardando aceite', 'PROPOSAL', 1),
  ('Em execução', 'ACTIVE', 2),
  ('Concluídas', 'COMPLETED', 3),
  ('Canceladas', 'CANCELED', 4)
) as seed(name, system_key, position)
on conflict do nothing;

update public.project_engagements e
set kanban_board_id = b.id,
    updated_at = now()
from public.project_kanban_boards b
where b.organization_id = e.organization_id
  and b.project_id = e.project_id
  and b.system_key = e.status
  and b.active
  and e.kanban_board_id is null;

create or replace function public.seed_project_kanban_boards()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  insert into public.project_kanban_boards (organization_id, project_id, name, system_key, position)
  values
    (new.organization_id, new.id, 'Aguardando aceite', 'PROPOSAL', 1),
    (new.organization_id, new.id, 'Em execução', 'ACTIVE', 2),
    (new.organization_id, new.id, 'Concluídas', 'COMPLETED', 3),
    (new.organization_id, new.id, 'Canceladas', 'CANCELED', 4)
  on conflict do nothing;
  return new;
end;
$$;

revoke all on function public.seed_project_kanban_boards() from public, anon, authenticated;
create trigger projects_seed_kanban_boards
  after insert on public.projects
  for each row execute function public.seed_project_kanban_boards();

create or replace function public.assign_project_engagement_kanban_board()
returns trigger
language plpgsql
as $$
begin
  if new.kanban_board_id is null then
    select b.id into new.kanban_board_id
    from public.project_kanban_boards b
    where b.organization_id = new.organization_id
      and b.project_id = new.project_id
      and b.system_key = new.status
      and b.active
    limit 1;
    if new.kanban_board_id is null then
      raise exception using errcode = '23514', message = 'project kanban board not configured';
    end if;
  end if;
  return new;
end;
$$;

create trigger project_engagements_assign_kanban_board
  before insert on public.project_engagements
  for each row execute function public.assign_project_engagement_kanban_board();

alter table public.project_engagements alter column kanban_board_id set not null;

create or replace function public.upsert_project_kanban_board(
  p_organization_id uuid,
  p_project_id uuid,
  p_id uuid,
  p_name text,
  p_position integer default null
)
returns public.project_kanban_boards
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_board public.project_kanban_boards;
  v_position integer;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'kanban board access denied';
  end if;
  if not public.organization_module_enabled(p_organization_id, 'projects') then
    raise exception using errcode = '42501', message = 'projects module disabled';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) < 2 or char_length(btrim(p_name)) > 80 then
    raise exception using errcode = '22023', message = 'kanban board name must contain 2 to 80 characters';
  end if;
  if p_id is null then
    select coalesce(max(position), 0) + 1 into v_position
    from public.project_kanban_boards
    where organization_id = p_organization_id and project_id = p_project_id and active;
    insert into public.project_kanban_boards (organization_id, project_id, name, position)
    values (p_organization_id, p_project_id, btrim(p_name), coalesce(p_position, v_position))
    returning * into v_board;
  else
    update public.project_kanban_boards
       set name = btrim(p_name),
           position = coalesce(p_position, position),
           updated_at = now()
     where id = p_id and organization_id = p_organization_id
       and project_id = p_project_id and active
     returning * into v_board;
    if not found then
      raise exception using errcode = 'P0002', message = 'kanban board not found';
    end if;
  end if;
  return v_board;
end;
$$;

revoke all on function public.upsert_project_kanban_board(uuid, uuid, uuid, text, integer) from public, anon;
grant execute on function public.upsert_project_kanban_board(uuid, uuid, uuid, text, integer) to authenticated;

create or replace function public.delete_project_kanban_board(
  p_organization_id uuid,
  p_project_id uuid,
  p_id uuid,
  p_destination_id uuid default null
)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_source public.project_kanban_boards;
  v_destination public.project_kanban_boards;
  v_card_count integer;
  v_active_count integer;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'kanban board access denied';
  end if;
  if not public.organization_module_enabled(p_organization_id, 'projects') then
    raise exception using errcode = '42501', message = 'projects module disabled';
  end if;
  select * into v_source
    from public.project_kanban_boards
   where id = p_id and organization_id = p_organization_id
     and project_id = p_project_id and active
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'kanban board not found';
  end if;
  select count(*) into v_active_count
    from public.project_kanban_boards
   where organization_id = p_organization_id and project_id = p_project_id and active;
  if v_active_count <= 1 then
    raise exception using errcode = '23514', message = 'project must keep at least one kanban board';
  end if;
  select count(*) into v_card_count
    from public.project_engagements
   where organization_id = p_organization_id and project_id = p_project_id and kanban_board_id = p_id;
  if v_card_count > 0 and p_destination_id is null then
    raise exception using errcode = '22023', message = 'choose a destination board before deleting a board with cards';
  end if;
  if p_destination_id is not null then
    select * into v_destination
      from public.project_kanban_boards
     where id = p_destination_id and organization_id = p_organization_id
       and project_id = p_project_id and active and id <> p_id
     for update;
    if not found then
      raise exception using errcode = '22023', message = 'destination kanban board is invalid';
    end if;
    update public.project_engagements
       set kanban_board_id = p_destination_id, updated_at = now()
     where organization_id = p_organization_id and project_id = p_project_id and kanban_board_id = p_id;
  end if;
  update public.project_kanban_boards
     set active = false, updated_at = now()
   where id = p_id and organization_id = p_organization_id;
end;
$$;

revoke all on function public.delete_project_kanban_board(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.delete_project_kanban_board(uuid, uuid, uuid, uuid) to authenticated;
