-- Keep movement protection explicit at the database boundary and use a stable
-- message that the UI can translate into an actionable notification.
create or replace function public.guard_project_engagement_internal_service_move()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.kanban_board_id is distinct from old.kanban_board_id and exists (
    select 1 from public.project_engagement_internal_services internal_service
    where internal_service.organization_id = old.organization_id
      and internal_service.engagement_id = old.id
      and internal_service.kanban_board_id = old.kanban_board_id
      and internal_service.status = 'OPEN'
  ) then
    raise exception using errcode = '22023', message = 'open internal service pending completion';
  end if;
  return new;
end;
$$;

create or replace function public.guard_project_internal_card_move()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.kanban_board_id is distinct from old.kanban_board_id and exists (
    select 1 from public.project_engagement_internal_services internal_service
    where internal_service.organization_id = old.organization_id
      and internal_service.internal_card_id = old.id
      and internal_service.kanban_board_id = old.kanban_board_id
      and internal_service.status = 'OPEN'
  ) then
    raise exception using errcode = '22023', message = 'open internal service pending completion';
  end if;
  return new;
end;
$$;

create or replace function public.delete_project_engagement_internal_service(
  p_organization_id uuid,
  p_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_service public.project_engagement_internal_services%rowtype;
begin
  perform public.require_financial_owner(p_organization_id, 'delete project internal service');
  select * into v_service
  from public.project_engagement_internal_services
  where organization_id = p_organization_id and id = p_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'project internal service not found';
  end if;
  if v_service.status <> 'OPEN'
    or v_service.commission_ledger_entry_id is not null
    or exists (
      select 1 from public.commission_ledger ledger
      where ledger.organization_id = p_organization_id
        and ledger.project_internal_service_id = p_id
    ) then
    raise exception using errcode = '22023', message = 'only open internal services can be deleted';
  end if;
  delete from public.project_engagement_internal_services
  where organization_id = p_organization_id and id = p_id;
  return true;
end;
$$;
revoke all on function public.delete_project_engagement_internal_service(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_project_engagement_internal_service(uuid, uuid) to authenticated;
