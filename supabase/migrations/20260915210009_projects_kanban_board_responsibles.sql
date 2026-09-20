alter table public.project_kanban_boards add column responsible_barber_id uuid;
alter table public.project_kanban_boards
  add constraint project_kanban_boards_responsible_barber_fk
  foreign key (responsible_barber_id, organization_id)
  references public.barbers(id, organization_id)
  on delete restrict;

update public.project_kanban_boards b
set responsible_barber_id = (
  select br.id
  from public.barbers br
  where br.organization_id = b.organization_id and br.active
  order by br.id
  limit 1
)
where b.responsible_barber_id is null;

do $$
begin
  if exists (select 1 from public.project_kanban_boards where responsible_barber_id is null) then
    raise exception using errcode = '23502', message = 'every project kanban board requires an active responsible barber';
  end if;
end;
$$;

alter table public.project_kanban_boards alter column responsible_barber_id set not null;

create or replace function public.seed_project_kanban_boards()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_responsible_barber_id uuid;
begin
  select br.id into v_responsible_barber_id
  from public.barbers br
  where br.organization_id = new.organization_id and br.active
  order by br.id
  limit 1;
  if v_responsible_barber_id is null then
    raise exception using errcode = '23514', message = 'project requires an active barber before creating kanban boards';
  end if;
  insert into public.project_kanban_boards (organization_id, project_id, name, system_key, position, responsible_barber_id)
  values
    (new.organization_id, new.id, 'Aguardando aceite', 'PROPOSAL', 1, v_responsible_barber_id),
    (new.organization_id, new.id, 'Em execução', 'ACTIVE', 2, v_responsible_barber_id),
    (new.organization_id, new.id, 'Concluídas', 'COMPLETED', 3, v_responsible_barber_id),
    (new.organization_id, new.id, 'Canceladas', 'CANCELED', 4, v_responsible_barber_id)
  on conflict do nothing;
  return new;
end;
$$;

drop function public.upsert_project_kanban_board(uuid, uuid, uuid, text, integer);
create function public.upsert_project_kanban_board(
  p_organization_id uuid,
  p_project_id uuid,
  p_id uuid,
  p_name text,
  p_position integer default null,
  p_responsible_barber_id uuid default null
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
  if p_responsible_barber_id is null or not exists (
    select 1 from public.barbers br
    where br.id = p_responsible_barber_id and br.organization_id = p_organization_id and br.active
  ) then
    raise exception using errcode = '22023', message = 'kanban board requires an active responsible barber';
  end if;
  if p_id is null then
    select coalesce(max(position), 0) + 1 into v_position
    from public.project_kanban_boards
    where organization_id = p_organization_id and project_id = p_project_id and active;
    insert into public.project_kanban_boards (organization_id, project_id, name, position, responsible_barber_id)
    values (p_organization_id, p_project_id, btrim(p_name), coalesce(p_position, v_position), p_responsible_barber_id)
    returning * into v_board;
  else
    update public.project_kanban_boards
       set name = btrim(p_name),
           position = coalesce(p_position, position),
           responsible_barber_id = p_responsible_barber_id,
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

revoke all on function public.upsert_project_kanban_board(uuid, uuid, uuid, text, integer, uuid) from public, anon;
grant execute on function public.upsert_project_kanban_board(uuid, uuid, uuid, text, integer, uuid) to authenticated;
