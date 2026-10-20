-- Kanban for appointments outside Projects. Data remains when the module is disabled.
insert into public.platform_modules(key, name, description)
values ('kanban', 'Kanban', 'Acompanhe os atendimentos de serviços, pacotes e assinaturas.')
on conflict (key) do update set name = excluded.name, description = excluded.description, updated_at = now();
create policy organization_kanban_entitlement_barber_read on public.organization_module_entitlements
for select to authenticated using (module_key='kanban' and public.is_organization_barber(organization_id));

create table public.service_kanban_boards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  position integer not null check (position >= 0),
  system_key text check (system_key is null or system_key = 'WAITING'),
  responsible_barber_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, position),
  foreign key (responsible_barber_id, organization_id) references public.barbers(id, organization_id),
  check (system_key is null or (position = 0 and name = 'Aguardando' and responsible_barber_id is null))
);
create unique index service_kanban_one_waiting on public.service_kanban_boards(organization_id) where system_key = 'WAITING';

create table public.service_kanban_cards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  board_id uuid not null,
  appointment_id uuid,
  customer_id uuid,
  service_id uuid,
  title text not null check (char_length(btrim(title)) between 2 and 160),
  origin_barber_id uuid not null,
  responsible_barber_id uuid not null,
  archived_at timestamptz,
  archived_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (appointment_id),
  foreign key (board_id, organization_id) references public.service_kanban_boards(id, organization_id),
  foreign key (appointment_id, organization_id) references public.appointments(id, organization_id),
  foreign key (customer_id, organization_id) references public.customers(id, organization_id),
  foreign key (service_id, organization_id) references public.services(id, organization_id),
  foreign key (origin_barber_id, organization_id) references public.barbers(id, organization_id),
  foreign key (responsible_barber_id, organization_id) references public.barbers(id, organization_id),
  check ((archived_at is null) = (archived_by is null))
);
create index service_kanban_cards_board on public.service_kanban_cards(organization_id, board_id, archived_at);
create index service_kanban_cards_responsible on public.service_kanban_cards(organization_id, responsible_barber_id, archived_at);

create table public.service_kanban_card_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  card_id uuid not null,
  action text not null check (action in ('CREATED', 'MOVED', 'REASSIGNED', 'EDITED', 'COMPLETED', 'REOPENED')),
  from_board_id uuid,
  to_board_id uuid,
  from_responsible_barber_id uuid,
  to_responsible_barber_id uuid,
  actor_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (card_id, organization_id) references public.service_kanban_cards(id, organization_id)
);

alter table public.service_kanban_boards enable row level security;
alter table public.service_kanban_boards force row level security;
alter table public.service_kanban_cards enable row level security;
alter table public.service_kanban_cards force row level security;
alter table public.service_kanban_card_events enable row level security;
alter table public.service_kanban_card_events force row level security;
create policy service_kanban_boards_read on public.service_kanban_boards for select to authenticated
using (public.organization_module_enabled(organization_id, 'kanban') and
  (public.is_organization_owner(organization_id) or public.is_organization_barber(organization_id)));
create policy service_kanban_cards_read on public.service_kanban_cards for select to authenticated
using (public.organization_module_enabled(organization_id, 'kanban') and
  (public.is_organization_owner(organization_id) or
    (archived_at is null and exists (
      select 1 from public.barbers b where b.id = responsible_barber_id and b.organization_id = service_kanban_cards.organization_id
        and b.auth_user_id = auth.uid() and b.active and b.app_access_enabled))));
create policy service_kanban_events_read on public.service_kanban_card_events for select to authenticated
using (public.organization_module_enabled(organization_id, 'kanban') and public.is_organization_owner(organization_id));
grant select on public.service_kanban_boards, public.service_kanban_cards, public.service_kanban_card_events to authenticated;

create function public.seed_service_kanban_boards() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.module_key = 'kanban' and new.enabled and (tg_op = 'INSERT' or not old.enabled) then
    if exists(select 1 from public.service_kanban_boards where organization_id=new.organization_id and system_key='WAITING') then
      return new;
    end if;
    insert into public.service_kanban_boards(organization_id,name,position,system_key)
    values (new.organization_id,'Aguardando',0,'WAITING') on conflict do nothing;
    insert into public.service_kanban_boards(organization_id,name,position)
    values (new.organization_id,'À Fazer',1),(new.organization_id,'Fazendo',2),(new.organization_id,'Feito',3)
    on conflict (organization_id,position) do nothing;
  end if;
  return new;
end $$;
create trigger seed_service_kanban_on_activation after insert or update of enabled on public.organization_module_entitlements
for each row execute function public.seed_service_kanban_boards();

create function public.create_service_kanban_card_on_start() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_board_id uuid; v_card_id uuid; v_name text;
begin
  if new.status <> 'IN_SERVICE' or old.status = 'IN_SERVICE'
     or not public.organization_module_enabled(new.organization_id,'kanban')
     or exists (select 1 from public.project_engagement_sessions s where s.organization_id = new.organization_id and s.appointment_id = new.id)
  then return new; end if;
  select id into v_board_id from public.service_kanban_boards where organization_id = new.organization_id and system_key = 'WAITING';
  if v_board_id is null then raise exception 'kanban waiting board missing' using errcode = 'P0002'; end if;
  select c.full_name into v_name from public.customers c where c.id = new.customer_id and c.organization_id = new.organization_id;
  insert into public.service_kanban_cards(organization_id,board_id,appointment_id,customer_id,title,origin_barber_id,responsible_barber_id)
  values (new.organization_id,v_board_id,new.id,new.customer_id,coalesce(nullif(btrim(v_name),''),'Atendimento'),new.barber_id,new.barber_id)
  on conflict (appointment_id) do nothing returning id into v_card_id;
  if v_card_id is not null then
    insert into public.service_kanban_card_events(organization_id,card_id,action,to_board_id,to_responsible_barber_id,actor_user_id)
    values (new.organization_id,v_card_id,'CREATED',v_board_id,new.barber_id,auth.uid());
  end if;
  return new;
end $$;
create trigger service_kanban_on_appointment_start after update of status on public.appointments
for each row execute function public.create_service_kanban_card_on_start();

create function public.save_service_kanban_board(p_organization_id uuid,p_board_id uuid,p_name text,p_responsible_barber_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_position integer; v_old_responsible uuid;
begin
  if not public.is_organization_owner(p_organization_id) or not public.organization_module_enabled(p_organization_id,'kanban') then
    raise exception using errcode='42501',message='kanban manager access denied';
  end if;
  if char_length(btrim(coalesce(p_name,''))) not between 2 and 80 then
    raise exception using errcode='22023',message='board name must have 2 to 80 characters';
  end if;
  if p_responsible_barber_id is not null and not exists (
    select 1 from public.barbers where id=p_responsible_barber_id and organization_id=p_organization_id and active and app_access_enabled
  ) then raise exception using errcode='22023',message='responsible professional unavailable'; end if;
  if p_board_id is null then
    select coalesce(max(position),0)+1 into v_position from public.service_kanban_boards where organization_id=p_organization_id;
    insert into public.service_kanban_boards(organization_id,name,position,responsible_barber_id)
    values(p_organization_id,btrim(p_name),v_position,p_responsible_barber_id) returning id into v_id;
  else
    select responsible_barber_id into v_old_responsible from public.service_kanban_boards
    where id=p_board_id and organization_id=p_organization_id and system_key is null for update;
    if p_responsible_barber_id is null and exists(
      select 1 from public.service_kanban_cards where organization_id=p_organization_id and board_id=p_board_id and archived_at is null
    ) then raise exception using errcode='22023',message='board with active cards requires a responsible professional'; end if;
    update public.service_kanban_boards set name=btrim(p_name),responsible_barber_id=p_responsible_barber_id,updated_at=now()
    where id=p_board_id and organization_id=p_organization_id and system_key is null returning id into v_id;
    if v_id is null then raise exception using errcode='22023',message='waiting board cannot be edited'; end if;
    if v_old_responsible is distinct from p_responsible_barber_id and p_responsible_barber_id is not null then
      insert into public.service_kanban_card_events(organization_id,card_id,action,from_board_id,to_board_id,from_responsible_barber_id,to_responsible_barber_id,actor_user_id)
      select p_organization_id,card.id,'REASSIGNED',p_board_id,p_board_id,card.responsible_barber_id,p_responsible_barber_id,auth.uid()
      from public.service_kanban_cards card where card.organization_id=p_organization_id and card.board_id=p_board_id and card.archived_at is null;
      update public.service_kanban_cards set responsible_barber_id=p_responsible_barber_id,updated_at=now()
      where organization_id=p_organization_id and board_id=p_board_id and archived_at is null;
    end if;
  end if;
  return v_id;
end $$;
create function public.delete_service_kanban_board(p_organization_id uuid,p_board_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.is_organization_owner(p_organization_id) or not public.organization_module_enabled(p_organization_id,'kanban') then
    raise exception using errcode='42501',message='kanban manager access denied'; end if;
  if exists(select 1 from public.service_kanban_cards where organization_id=p_organization_id and board_id=p_board_id) then
    raise exception using errcode='22023',message='move or remove board cards first'; end if;
  delete from public.service_kanban_boards where organization_id=p_organization_id and id=p_board_id and system_key is null;
  if not found then raise exception using errcode='22023',message='waiting board cannot be deleted'; end if;
end $$;

create function public.create_manual_service_kanban_card(p_organization_id uuid,p_title text,p_responsible_barber_id uuid,p_customer_id uuid default null,p_service_id uuid default null)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_board_id uuid; v_card_id uuid;
begin
  if not public.is_organization_owner(p_organization_id) or not public.organization_module_enabled(p_organization_id,'kanban') then
    raise exception using errcode='42501',message='kanban manager access denied'; end if;
  if char_length(btrim(coalesce(p_title,''))) not between 2 and 160 then
    raise exception using errcode='22023',message='card title must have 2 to 160 characters'; end if;
  if not exists(select 1 from public.barbers where id=p_responsible_barber_id and organization_id=p_organization_id and active and app_access_enabled) then
    raise exception using errcode='22023',message='responsible professional unavailable'; end if;
  select id into strict v_board_id from public.service_kanban_boards where organization_id=p_organization_id and system_key='WAITING';
  insert into public.service_kanban_cards(organization_id,board_id,title,origin_barber_id,responsible_barber_id,customer_id,service_id)
  values(p_organization_id,v_board_id,btrim(p_title),p_responsible_barber_id,p_responsible_barber_id,p_customer_id,p_service_id)
  returning id into v_card_id;
  insert into public.service_kanban_card_events(organization_id,card_id,action,to_board_id,to_responsible_barber_id,actor_user_id)
  values(p_organization_id,v_card_id,'CREATED',v_board_id,p_responsible_barber_id,auth.uid());
  return v_card_id;
end $$;

create function public.mutate_service_kanban_card(p_organization_id uuid,p_card_id uuid,p_action text,p_board_id uuid default null,p_title text default null)
returns public.service_kanban_cards language plpgsql security definer set search_path=public,pg_temp as $$
declare v_card public.service_kanban_cards; v_board public.service_kanban_boards; v_responsible uuid; v_old_board uuid; v_old_responsible uuid; v_owner boolean;
begin
  if not public.organization_module_enabled(p_organization_id,'kanban') then
    raise exception using errcode='42501',message='kanban module inactive'; end if;
  select * into strict v_card from public.service_kanban_cards where id=p_card_id and organization_id=p_organization_id for update;
  v_owner := public.is_organization_owner(p_organization_id);
  if not v_owner and (v_card.archived_at is not null or not exists(
    select 1 from public.barbers where id=v_card.responsible_barber_id and organization_id=p_organization_id
      and auth_user_id=auth.uid() and active and app_access_enabled)) then
    raise exception using errcode='42501',message='kanban card access denied'; end if;
  v_old_board := v_card.board_id; v_old_responsible := v_card.responsible_barber_id;
  if p_action='MOVED' then
    if v_card.archived_at is not null then raise exception using errcode='22023',message='archived card cannot move'; end if;
    select * into strict v_board from public.service_kanban_boards where id=p_board_id and organization_id=p_organization_id;
    v_responsible := case when v_board.system_key='WAITING' then v_card.origin_barber_id else v_board.responsible_barber_id end;
    if v_responsible is null then raise exception using errcode='22023',message='destination board has no responsible professional'; end if;
    update public.service_kanban_cards set board_id=v_board.id,responsible_barber_id=v_responsible,updated_at=now() where id=v_card.id returning * into v_card;
  elsif p_action='EDITED' then
    if v_card.archived_at is not null or char_length(btrim(coalesce(p_title,''))) not between 2 and 160 then
      raise exception using errcode='22023',message='invalid card title or archived card'; end if;
    update public.service_kanban_cards set title=btrim(p_title),updated_at=now() where id=v_card.id returning * into v_card;
  elsif p_action='COMPLETED' then
    if v_card.archived_at is not null then return v_card; end if;
    update public.service_kanban_cards set archived_at=now(),archived_by=auth.uid(),updated_at=now() where id=v_card.id returning * into v_card;
  elsif p_action='REOPENED' then
    if not v_owner then raise exception using errcode='42501',message='manager required to reopen'; end if;
    if v_card.archived_at is null then return v_card; end if;
    update public.service_kanban_cards set archived_at=null,archived_by=null,updated_at=now() where id=v_card.id returning * into v_card;
  else raise exception using errcode='22023',message='invalid kanban action'; end if;
  insert into public.service_kanban_card_events(organization_id,card_id,action,from_board_id,to_board_id,from_responsible_barber_id,to_responsible_barber_id,actor_user_id)
  values(p_organization_id,v_card.id,p_action,v_old_board,v_card.board_id,v_old_responsible,v_card.responsible_barber_id,auth.uid());
  return v_card;
end $$;
revoke all on function public.save_service_kanban_board(uuid,uuid,text,uuid), public.delete_service_kanban_board(uuid,uuid),
  public.create_manual_service_kanban_card(uuid,text,uuid,uuid,uuid), public.mutate_service_kanban_card(uuid,uuid,text,uuid,text) from public,anon;
grant execute on function public.save_service_kanban_board(uuid,uuid,text,uuid), public.delete_service_kanban_board(uuid,uuid),
  public.create_manual_service_kanban_card(uuid,text,uuid,uuid,uuid), public.mutate_service_kanban_card(uuid,uuid,text,uuid,text) to authenticated;
