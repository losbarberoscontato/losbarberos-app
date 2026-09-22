-- Standalone project cards are operational Kanban items, not contracts and not
-- customer records. Internal-service commission remains tied to the project
-- package assignment selected for the board professional.
create table public.project_kanban_internal_cards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  kanban_board_id uuid not null,
  title text not null default 'Card avulso' check (length(btrim(title)) between 1 and 120),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (id, organization_id, project_id),
  foreign key (project_id, organization_id) references public.projects(id, organization_id) on delete cascade,
  foreign key (kanban_board_id, organization_id) references public.project_kanban_boards(id, organization_id) on delete restrict
);

create index project_kanban_internal_cards_board_idx
  on public.project_kanban_internal_cards (organization_id, project_id, kanban_board_id, created_at);
alter table public.project_kanban_internal_cards enable row level security;
alter table public.project_kanban_internal_cards force row level security;
create policy project_kanban_internal_cards_owner_select
  on public.project_kanban_internal_cards for select to authenticated
  using (public.is_organization_owner(organization_id));
revoke all on public.project_kanban_internal_cards from public, anon, authenticated;
grant select on public.project_kanban_internal_cards to authenticated;

alter table public.project_engagement_internal_services
  alter column engagement_id drop not null;
alter table public.project_engagement_internal_services
  add column internal_card_id uuid;
alter table public.project_engagement_internal_services
  add constraint project_internal_service_exactly_one_card_check
    check (num_nonnulls(engagement_id, internal_card_id) = 1),
  add constraint project_internal_service_internal_card_fk
    foreign key (internal_card_id, organization_id, project_id)
    references public.project_kanban_internal_cards(id, organization_id, project_id)
    on delete cascade;
create unique index project_internal_service_card_board_key
  on public.project_engagement_internal_services (organization_id, internal_card_id, kanban_board_id)
  where internal_card_id is not null;

create or replace function public.create_project_kanban_internal_card(
  p_organization_id uuid, p_project_id uuid
)
returns public.project_kanban_internal_cards
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_project public.projects%rowtype;
  v_board public.project_kanban_boards%rowtype;
  v_card public.project_kanban_internal_cards%rowtype;
begin
  perform public.require_financial_owner(p_organization_id, 'create project internal card');
  select * into v_project from public.projects
    where organization_id = p_organization_id and id = p_project_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'project not found'; end if;
  select * into v_board from public.project_kanban_boards
    where organization_id = p_organization_id and project_id = p_project_id and active
    order by position, created_at, id limit 1 for update;
  if not found then raise exception using errcode = '22023', message = 'project requires an active kanban board'; end if;
  insert into public.project_kanban_internal_cards (organization_id, project_id, kanban_board_id, title, created_by)
  values (p_organization_id, p_project_id, v_board.id, 'Card avulso', auth.uid())
  returning * into v_card;
  return v_card;
end;
$$;
revoke all on function public.create_project_kanban_internal_card(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.create_project_kanban_internal_card(uuid, uuid) to authenticated;

create or replace function public.move_project_kanban_internal_card(
  p_organization_id uuid, p_project_id uuid, p_internal_card_id uuid, p_destination_board_id uuid
)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_card public.project_kanban_internal_cards%rowtype;
  v_board public.project_kanban_boards%rowtype;
begin
  perform public.require_financial_owner(p_organization_id, 'move project internal card');
  select * into v_card from public.project_kanban_internal_cards
    where organization_id = p_organization_id and project_id = p_project_id and id = p_internal_card_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'standalone project card not found'; end if;
  if v_card.kanban_board_id = p_destination_board_id then return; end if;
  select * into v_board from public.project_kanban_boards
    where organization_id = p_organization_id and project_id = p_project_id and id = p_destination_board_id and active for update;
  if not found then raise exception using errcode = '22023', message = 'destination kanban board is invalid'; end if;
  if exists (select 1 from public.project_engagement_internal_services
    where organization_id = p_organization_id and internal_card_id = p_internal_card_id
      and kanban_board_id = v_card.kanban_board_id and status = 'OPEN') then
    raise exception using errcode = '22023', message = 'complete the internal service before moving this card';
  end if;
  update public.project_kanban_internal_cards
    set kanban_board_id = v_board.id, updated_at = now()
    where organization_id = p_organization_id and id = p_internal_card_id;
end;
$$;
revoke all on function public.move_project_kanban_internal_card(uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.move_project_kanban_internal_card(uuid, uuid, uuid, uuid) to authenticated;

create or replace function public.guard_project_internal_card_move()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.kanban_board_id is distinct from old.kanban_board_id and exists (
    select 1 from public.project_engagement_internal_services service
    where service.organization_id = old.organization_id and service.internal_card_id = old.id
      and service.kanban_board_id = old.kanban_board_id and service.status = 'OPEN'
  ) then
    raise exception using errcode = '22023', message = 'complete the internal service before moving this card';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_project_internal_card_move() from public, anon, authenticated, service_role;
create trigger project_internal_card_move_guard before update of kanban_board_id
  on public.project_kanban_internal_cards for each row execute function public.guard_project_internal_card_move();

create or replace function public.upsert_project_kanban_internal_card_service(
  p_organization_id uuid, p_project_id uuid, p_internal_card_id uuid, p_board_id uuid,
  p_id uuid, p_service_assignment_id uuid, p_commission_cents bigint, p_delivery_on date
)
returns public.project_engagement_internal_services
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_card public.project_kanban_internal_cards%rowtype;
  v_board public.project_kanban_boards%rowtype;
  v_assignment public.project_package_service_assignments%rowtype;
  v_service public.services%rowtype;
  v_result public.project_engagement_internal_services%rowtype;
begin
  perform public.require_financial_owner(p_organization_id, 'project internal service');
  select * into v_card from public.project_kanban_internal_cards
    where organization_id = p_organization_id and project_id = p_project_id and id = p_internal_card_id for update;
  if not found or v_card.kanban_board_id is distinct from p_board_id then
    raise exception using errcode = 'P0002', message = 'standalone card is not in the selected board';
  end if;
  select * into v_board from public.project_kanban_boards
    where organization_id = p_organization_id and project_id = p_project_id and id = p_board_id and active;
  if not found then raise exception using errcode = 'P0002', message = 'active project board not found'; end if;
  if p_id is null then
    if exists (select 1 from public.project_engagement_internal_services
      where organization_id = p_organization_id and internal_card_id = p_internal_card_id and status = 'OPEN') then
      raise exception using errcode = '22023', message = 'complete the current internal service before adding another';
    end if;
    select assignment.* into v_assignment
      from public.project_package_service_assignments assignment
      join public.project_packages package on package.id = assignment.project_package_id
        and package.organization_id = assignment.organization_id and package.project_id = p_project_id
      where assignment.organization_id = p_organization_id and assignment.id = p_service_assignment_id
        and assignment.barber_id = v_board.responsible_barber_id;
    if not found then raise exception using errcode = '22023', message = 'service is not assigned to a project package and board professional'; end if;
    select * into v_service from public.services
      where organization_id = p_organization_id and id = v_assignment.service_id and active;
    if not found then raise exception using errcode = 'P0002', message = 'active service not found'; end if;
    insert into public.project_engagement_internal_services (
      organization_id, project_id, engagement_id, internal_card_id, kanban_board_id,
      package_assignment_id, service_id, service_name, barber_id, commission_cents, delivery_on
    ) values (
      p_organization_id, p_project_id, null, p_internal_card_id, p_board_id,
      v_assignment.id, v_service.id, v_service.name, v_board.responsible_barber_id,
      v_assignment.commission_cents, p_delivery_on
    ) returning * into v_result;
  else
    select * into v_result from public.project_engagement_internal_services
      where organization_id = p_organization_id and project_id = p_project_id
        and internal_card_id = p_internal_card_id and kanban_board_id = p_board_id and id = p_id for update;
    if not found or v_result.status <> 'OPEN' then
      raise exception using errcode = '22023', message = 'completed internal service cannot be changed';
    end if;
    if p_service_assignment_id <> v_result.package_assignment_id then
      raise exception using errcode = '22023', message = 'service assignment cannot be changed after creation';
    end if;
    update public.project_engagement_internal_services set commission_cents = p_commission_cents,
      delivery_on = p_delivery_on, updated_at = now()
      where organization_id = p_organization_id and id = p_id returning * into v_result;
  end if;
  return v_result;
end;
$$;
revoke all on function public.upsert_project_kanban_internal_card_service(uuid, uuid, uuid, uuid, uuid, uuid, bigint, date) from public, anon, authenticated, service_role;
grant execute on function public.upsert_project_kanban_internal_card_service(uuid, uuid, uuid, uuid, uuid, uuid, bigint, date) to authenticated;

create or replace function public.complete_project_engagement_internal_service(
  p_organization_id uuid, p_internal_service_id uuid, p_idempotency_key text
)
returns public.project_engagement_internal_services
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_service public.project_engagement_internal_services%rowtype;
  v_engagement public.project_engagements%rowtype;
  v_card public.project_kanban_internal_cards%rowtype;
  v_ledger_id uuid;
  v_key text;
begin
  perform public.require_financial_owner(p_organization_id, 'complete project internal service');
  select * into v_service from public.project_engagement_internal_services
    where organization_id = p_organization_id and id = p_internal_service_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'project internal service not found'; end if;
  if v_service.status = 'COMPLETED' then return v_service; end if;
  if v_service.engagement_id is not null then
    select * into v_engagement from public.project_engagements
      where organization_id = p_organization_id and id = v_service.engagement_id for update;
    if not found or v_engagement.kanban_board_id is distinct from v_service.kanban_board_id then
      raise exception using errcode = '22023', message = 'move the engagement to another board before completing this service';
    end if;
  else
    select * into v_card from public.project_kanban_internal_cards
      where organization_id = p_organization_id and id = v_service.internal_card_id for update;
    if not found or v_card.kanban_board_id is distinct from v_service.kanban_board_id then
      raise exception using errcode = '22023', message = 'move the standalone card to another board before completing this service';
    end if;
  end if;
  if v_service.delivery_on is null then raise exception using errcode = '22023', message = 'delivery date is required before completion'; end if;
  v_key := 'project-internal-service:' || v_service.id || ':commission:v1';
  if v_service.commission_cents > 0 and p_idempotency_key is distinct from v_key then
    raise exception using errcode = '22023', message = 'invalid internal service idempotency key';
  end if;
  update public.project_engagement_internal_services set status = 'COMPLETED', updated_at = now()
    where organization_id = p_organization_id and id = p_internal_service_id returning * into v_service;
  if v_service.commission_cents > 0 then
    insert into public.commission_ledger (
      organization_id, barber_id, appointment_id, appointment_item_id, project_internal_service_id,
      kind, amount_cents, idempotency_key, earned_at, created_by
    ) values (
      p_organization_id, v_service.barber_id, null, null, v_service.id,
      'EARNED', v_service.commission_cents, v_key,
      v_service.delivery_on::timestamp at time zone 'America/Sao_Paulo', auth.uid()
    ) on conflict (organization_id, idempotency_key) do nothing returning id into v_ledger_id;
    if v_ledger_id is null then
      select id into v_ledger_id from public.commission_ledger where organization_id = p_organization_id and idempotency_key = v_key;
    end if;
    update public.project_engagement_internal_services set commission_ledger_entry_id = v_ledger_id
      where organization_id = p_organization_id and id = p_internal_service_id returning * into v_service;
  end if;
  return v_service;
end;
$$;
revoke all on function public.complete_project_engagement_internal_service(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.complete_project_engagement_internal_service(uuid, uuid, text) to authenticated;

-- Board archival moves both types of cards, preserving their board-specific
-- service history and respecting the same open-service guard.
create or replace function public.delete_project_kanban_board(
  p_organization_id uuid, p_project_id uuid, p_id uuid, p_destination_id uuid default null
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_source public.project_kanban_boards%rowtype;
  v_destination public.project_kanban_boards%rowtype;
  v_card_count integer;
  v_active_count integer;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'kanban board access denied';
  end if;
  if not public.organization_module_enabled(p_organization_id, 'projects') then
    raise exception using errcode = '42501', message = 'projects module disabled';
  end if;
  select * into v_source from public.project_kanban_boards
    where id = p_id and organization_id = p_organization_id and project_id = p_project_id and active for update;
  if not found then raise exception using errcode = 'P0002', message = 'kanban board not found'; end if;
  select count(*) into v_active_count from public.project_kanban_boards
    where organization_id = p_organization_id and project_id = p_project_id and active;
  if v_active_count <= 1 then raise exception using errcode = '23514', message = 'project must keep at least one kanban board'; end if;
  select (select count(*) from public.project_engagements where organization_id = p_organization_id and project_id = p_project_id and kanban_board_id = p_id)
       + (select count(*) from public.project_kanban_internal_cards where organization_id = p_organization_id and project_id = p_project_id and kanban_board_id = p_id)
    into v_card_count;
  if v_card_count > 0 and p_destination_id is null then
    raise exception using errcode = '22023', message = 'choose a destination board before deleting a board with cards';
  end if;
  if p_destination_id is not null then
    select * into v_destination from public.project_kanban_boards
      where id = p_destination_id and organization_id = p_organization_id and project_id = p_project_id and active and id <> p_id for update;
    if not found then raise exception using errcode = '22023', message = 'destination kanban board is invalid'; end if;
    update public.project_engagements set kanban_board_id = p_destination_id, updated_at = now()
      where organization_id = p_organization_id and project_id = p_project_id and kanban_board_id = p_id;
    update public.project_kanban_internal_cards set kanban_board_id = p_destination_id, updated_at = now()
      where organization_id = p_organization_id and project_id = p_project_id and kanban_board_id = p_id;
  end if;
  update public.project_kanban_boards set active = false, updated_at = now()
    where id = p_id and organization_id = p_organization_id;
end;
$$;
revoke all on function public.delete_project_kanban_board(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.delete_project_kanban_board(uuid, uuid, uuid, uuid) to authenticated;
