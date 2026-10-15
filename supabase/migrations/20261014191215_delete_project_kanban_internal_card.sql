create or replace function public.delete_project_kanban_internal_card(
  p_organization_id uuid,
  p_project_id uuid,
  p_internal_card_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_card public.project_kanban_internal_cards%rowtype;
begin
  perform public.require_financial_owner(p_organization_id, 'delete project internal card');

  select * into v_card
  from public.project_kanban_internal_cards
  where organization_id = p_organization_id
    and project_id = p_project_id
    and id = p_internal_card_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'standalone project card not found';
  end if;

  if exists (
    select 1
    from public.project_engagement_internal_services internal_service
    where internal_service.organization_id = p_organization_id
      and internal_service.project_id = p_project_id
      and internal_service.internal_card_id = p_internal_card_id
      and (
        internal_service.status <> 'OPEN'
        or internal_service.commission_ledger_entry_id is not null
        or exists (
          select 1 from public.commission_ledger ledger
          where ledger.organization_id = p_organization_id
            and ledger.project_internal_service_id = internal_service.id
        )
      )
  ) then
    raise exception using errcode = '22023', message = 'standalone card with completed or commissioned internal service cannot be deleted';
  end if;

  delete from public.project_kanban_internal_cards
  where organization_id = p_organization_id
    and project_id = p_project_id
    and id = p_internal_card_id;
  return true;
end;
$$;

revoke all on function public.delete_project_kanban_internal_card(uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_project_kanban_internal_card(uuid, uuid, uuid) to authenticated;
