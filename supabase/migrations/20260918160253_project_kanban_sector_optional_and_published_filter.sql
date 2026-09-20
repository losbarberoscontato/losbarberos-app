-- Quadros de projeto podem ficar sem setor; nesses casos não aparecem no Kanban Geral.
drop trigger if exists project_kanban_boards_assign_sector on public.project_kanban_boards;
drop function if exists public.ensure_project_kanban_board_sector();

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
  if p_sector_id is not null and not exists (
    select 1 from public.project_kanban_sectors
     where id = p_sector_id and organization_id = p_organization_id and active
  ) then
    raise exception using errcode = '22023', message = 'kanban board sector is invalid';
  end if;
  select * into v_board from public.upsert_project_kanban_board(
    p_organization_id, p_project_id, p_id, p_name, p_position, p_responsible_barber_id
  );
  update public.project_kanban_boards
     set sector_id = p_sector_id, updated_at = now()
   where id = v_board.id and organization_id = p_organization_id
   returning * into v_board;
  return v_board;
end;
$$;

revoke all on function public.upsert_project_kanban_board_with_sector(uuid, uuid, uuid, text, integer, uuid, uuid) from public, anon;
grant execute on function public.upsert_project_kanban_board_with_sector(uuid, uuid, uuid, text, integer, uuid, uuid) to authenticated;
