-- Atualiza assinatura, status comercial e coluna operacional do Kanban atomically.
create or replace function public.set_project_engagement_status(
  p_organization_id uuid,
  p_project_id uuid,
  p_engagement_id uuid,
  p_status text,
  p_accepted_on date default null,
  p_kanban_board_id uuid default null
) returns public.project_engagements
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_engagement public.project_engagements;
  v_board public.project_kanban_boards;
  v_accepted_at timestamptz;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'project engagement status write denied';
  end if;
  if not public.organization_module_enabled(p_organization_id, 'projects') then
    raise exception using errcode = '42501', message = 'projects module disabled';
  end if;
  if p_status not in ('PROPOSAL', 'ACTIVE', 'COMPLETED', 'CANCELED') then
    raise exception using errcode = '22023', message = 'invalid project engagement status';
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

  select * into v_board
    from public.project_kanban_boards
   where id = coalesce(p_kanban_board_id, v_engagement.kanban_board_id)
     and organization_id = p_organization_id
     and project_id = p_project_id
     and active;
  if not found then
    raise exception using errcode = '22023', message = 'project kanban board not found';
  end if;

  v_accepted_at := case
    when p_status = 'PROPOSAL' then null
    when p_accepted_on is not null then p_accepted_on::timestamptz
    else v_engagement.accepted_at
  end;

  update public.project_engagements
     set status = p_status,
         accepted_at = v_accepted_at,
         kanban_board_id = v_board.id,
         updated_at = now()
   where id = v_engagement.id
     and organization_id = p_organization_id
  returning * into v_engagement;

  return v_engagement;
end;
$$;

revoke all on function public.set_project_engagement_status(uuid, uuid, uuid, text, date, uuid) from public, anon;
grant execute on function public.set_project_engagement_status(uuid, uuid, uuid, text, date, uuid) to authenticated;
