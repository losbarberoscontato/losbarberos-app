-- Move a project engagement between active Kanban boards without changing the
-- commercial lifecycle status. The board assignment is the operational status.
create function public.move_project_engagement_to_kanban_board(
  p_organization_id uuid,
  p_project_id uuid,
  p_engagement_id uuid,
  p_destination_board_id uuid
)
returns public.project_engagements
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_engagement public.project_engagements;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'kanban engagement access denied';
  end if;
  if not public.organization_module_enabled(p_organization_id, 'projects') then
    raise exception using errcode = '42501', message = 'projects module disabled';
  end if;
  if not exists (
    select 1
    from public.project_kanban_boards b
    where b.id = p_destination_board_id
      and b.organization_id = p_organization_id
      and b.project_id = p_project_id
      and b.active
  ) then
    raise exception using errcode = '22023', message = 'destination kanban board is invalid';
  end if;
  select * into v_engagement
  from public.project_engagements e
  where e.id = p_engagement_id
    and e.organization_id = p_organization_id
    and e.project_id = p_project_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'project engagement not found';
  end if;
  if v_engagement.kanban_board_id <> p_destination_board_id then
    update public.project_engagements
       set kanban_board_id = p_destination_board_id,
           updated_at = now()
     where id = p_engagement_id
       and organization_id = p_organization_id
       and project_id = p_project_id
    returning * into v_engagement;
  end if;
  return v_engagement;
end;
$$;

revoke all on function public.move_project_engagement_to_kanban_board(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.move_project_engagement_to_kanban_board(uuid, uuid, uuid, uuid) to authenticated;
