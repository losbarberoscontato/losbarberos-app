alter table public.service_kanban_cards
  add column received_at timestamptz,
  add column received_by uuid references auth.users(id),
  add column received_by_name text,
  add column due_on date;

update public.service_kanban_cards c
   set received_at = coalesce(c.received_at, c.created_at),
       received_by_name = coalesce(
         nullif(btrim(c.received_by_name), ''),
         (select nullif(btrim(p.display_name), '') from public.profiles p where p.id = c.received_by),
         (select nullif(btrim(b.display_name), '') from public.barbers b where b.id = c.origin_barber_id and b.organization_id = c.organization_id),
         'Sistema'
       );

alter table public.service_kanban_cards
  alter column received_at set default now(),
  alter column received_at set not null,
  alter column received_by_name set default 'Sistema',
  alter column received_by_name set not null;

create table public.service_kanban_card_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  card_id uuid not null,
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  author_user_id uuid not null references auth.users(id),
  author_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (card_id, organization_id) references public.service_kanban_cards(id, organization_id) on delete cascade
);

create index service_kanban_card_comments_card_idx
  on public.service_kanban_card_comments (organization_id, card_id, created_at desc);

create table public.service_kanban_card_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  card_id uuid not null,
  label text not null check (char_length(btrim(label)) between 1 and 120),
  url text not null check (char_length(url) <= 2048 and url ~* '^https?://'),
  created_by_user_id uuid not null references auth.users(id),
  created_by_role text not null check (created_by_role in ('OWNER', 'BARBER')),
  created_at timestamptz not null default now(),
  foreign key (card_id, organization_id) references public.service_kanban_cards(id, organization_id) on delete cascade
);

create index service_kanban_card_links_card_idx
  on public.service_kanban_card_links (organization_id, card_id, created_at);

alter table public.service_kanban_card_comments enable row level security;
alter table public.service_kanban_card_comments force row level security;
alter table public.service_kanban_card_links enable row level security;
alter table public.service_kanban_card_links force row level security;

create policy service_kanban_card_comments_read on public.service_kanban_card_comments
  for select to authenticated
  using (public.organization_module_enabled(organization_id, 'kanban') and (
    public.is_organization_owner(organization_id) or exists (
      select 1 from public.service_kanban_cards c
      join public.barbers b on b.id = c.responsible_barber_id and b.organization_id = c.organization_id
      where c.id = service_kanban_card_comments.card_id and c.organization_id = service_kanban_card_comments.organization_id
        and c.archived_at is null and b.auth_user_id = auth.uid() and b.active and b.app_access_enabled
    )
  ));
create policy service_kanban_card_links_read on public.service_kanban_card_links
  for select to authenticated
  using (public.organization_module_enabled(organization_id, 'kanban') and (
    public.is_organization_owner(organization_id) or exists (
      select 1 from public.service_kanban_cards c
      join public.barbers b on b.id = c.responsible_barber_id and b.organization_id = c.organization_id
      where c.id = service_kanban_card_links.card_id and c.organization_id = service_kanban_card_links.organization_id
        and c.archived_at is null and b.auth_user_id = auth.uid() and b.active and b.app_access_enabled
    )
  ));

revoke all on public.service_kanban_card_comments, public.service_kanban_card_links from public, anon, authenticated;
grant select on public.service_kanban_card_comments, public.service_kanban_card_links to authenticated;

create or replace function public.create_service_kanban_card_on_start()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_board_id uuid;
  v_card_id uuid;
  v_name text;
  v_actor_name text;
begin
  if new.status <> 'IN_SERVICE' or old.status = 'IN_SERVICE'
     or not public.organization_module_enabled(new.organization_id, 'kanban')
     or exists (select 1 from public.project_engagement_sessions s where s.organization_id = new.organization_id and s.appointment_id = new.id)
  then return new; end if;
  select id into v_board_id from public.service_kanban_boards where organization_id = new.organization_id and system_key = 'WAITING';
  if v_board_id is null then raise exception 'kanban waiting board missing' using errcode = 'P0002'; end if;
  select c.full_name into v_name from public.customers c where c.id = new.customer_id and c.organization_id = new.organization_id;
  select coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(b.display_name), ''), 'Sistema')
    into v_actor_name
    from public.barbers b left join public.profiles p on p.id = auth.uid()
   where b.id = new.barber_id and b.organization_id = new.organization_id;
  insert into public.service_kanban_cards(
    organization_id, board_id, appointment_id, customer_id, title,
    origin_barber_id, responsible_barber_id, received_at, received_by, received_by_name
  )
  values (
    new.organization_id, v_board_id, new.id, new.customer_id, coalesce(nullif(btrim(v_name), ''), 'Atendimento'),
    new.barber_id, new.barber_id, now(), auth.uid(), coalesce(v_actor_name, 'Sistema')
  )
  on conflict (appointment_id) do nothing returning id into v_card_id;
  if v_card_id is not null then
    insert into public.service_kanban_card_events(organization_id, card_id, action, to_board_id, to_responsible_barber_id, actor_user_id)
    values (new.organization_id, v_card_id, 'CREATED', v_board_id, new.barber_id, auth.uid());
  end if;
  return new;
end $$;

create or replace function public.create_manual_service_kanban_card(
  p_organization_id uuid,
  p_title text,
  p_responsible_barber_id uuid,
  p_customer_id uuid,
  p_service_id uuid,
  p_description text
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_board_id uuid;
  v_card_id uuid;
  v_actor_name text;
begin
  if not public.is_organization_owner(p_organization_id) or not public.organization_module_enabled(p_organization_id, 'kanban') then
    raise exception using errcode = '42501', message = 'kanban manager access denied';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 2 and 160 then
    raise exception using errcode = '22023', message = 'card title must have 2 to 160 characters';
  end if;
  if not exists (select 1 from public.barbers where id = p_responsible_barber_id and organization_id = p_organization_id and active and app_access_enabled) then
    raise exception using errcode = '22023', message = 'responsible professional unavailable';
  end if;
  select id into strict v_board_id from public.service_kanban_boards where organization_id = p_organization_id and system_key = 'WAITING';
  select coalesce(nullif(btrim(display_name), ''), 'Gestor') into v_actor_name from public.profiles where id = auth.uid();
  insert into public.service_kanban_cards(
    organization_id, board_id, title, description, origin_barber_id, responsible_barber_id,
    customer_id, service_id, received_at, received_by, received_by_name
  )
  values (
    p_organization_id, v_board_id, btrim(p_title), nullif(btrim(p_description), ''), p_responsible_barber_id,
    p_responsible_barber_id, p_customer_id, p_service_id, now(), auth.uid(), coalesce(v_actor_name, 'Gestor')
  ) returning id into v_card_id;
  insert into public.service_kanban_card_events(organization_id, card_id, action, to_board_id, to_responsible_barber_id, actor_user_id)
  values (p_organization_id, v_card_id, 'CREATED', v_board_id, p_responsible_barber_id, auth.uid());
  return v_card_id;
end $$;

create or replace function public.mutate_service_kanban_card(
  p_organization_id uuid, p_card_id uuid, p_action text, p_board_id uuid default null, p_title text default null
)
returns public.service_kanban_cards language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_card public.service_kanban_cards;
  v_board public.service_kanban_boards;
  v_responsible uuid;
  v_old_board uuid;
  v_old_responsible uuid;
  v_owner boolean;
  v_actor_name text;
begin
  if not public.organization_module_enabled(p_organization_id, 'kanban') then
    raise exception using errcode = '42501', message = 'kanban module inactive';
  end if;
  select * into strict v_card from public.service_kanban_cards where id = p_card_id and organization_id = p_organization_id for update;
  v_owner := public.is_organization_owner(p_organization_id);
  if not v_owner and (v_card.archived_at is not null or not exists (
    select 1 from public.barbers where id = v_card.responsible_barber_id and organization_id = p_organization_id
      and auth_user_id = auth.uid() and active and app_access_enabled
  )) then raise exception using errcode = '42501', message = 'kanban card access denied'; end if;
  v_old_board := v_card.board_id;
  v_old_responsible := v_card.responsible_barber_id;
  if p_action = 'MOVED' then
    if v_card.archived_at is not null then raise exception using errcode = '22023', message = 'archived card cannot move'; end if;
    select * into strict v_board from public.service_kanban_boards where id = p_board_id and organization_id = p_organization_id;
    v_responsible := case when v_board.system_key = 'WAITING' then v_card.origin_barber_id else v_board.responsible_barber_id end;
    if v_responsible is null then raise exception using errcode = '22023', message = 'destination board has no responsible professional'; end if;
    select coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(b.display_name), ''), 'Sistema')
      into v_actor_name from public.profiles p left join public.barbers b on b.auth_user_id = auth.uid() and b.organization_id = p_organization_id
     where p.id = auth.uid();
    update public.service_kanban_cards
       set board_id = v_board.id, responsible_barber_id = v_responsible, due_on = null,
           received_at = now(), received_by = auth.uid(), received_by_name = coalesce(v_actor_name, 'Sistema'), updated_at = now()
     where id = v_card.id returning * into v_card;
  elsif p_action = 'EDITED' then
    if v_card.archived_at is not null or char_length(btrim(coalesce(p_title, ''))) not between 2 and 160 then
      raise exception using errcode = '22023', message = 'invalid card title or archived card';
    end if;
    update public.service_kanban_cards set title = btrim(p_title), updated_at = now() where id = v_card.id returning * into v_card;
  elsif p_action = 'COMPLETED' then
    if v_card.archived_at is not null then return v_card; end if;
    update public.service_kanban_cards set archived_at = now(), archived_by = auth.uid(), updated_at = now() where id = v_card.id returning * into v_card;
  elsif p_action = 'REOPENED' then
    if not v_owner then raise exception using errcode = '42501', message = 'manager required to reopen'; end if;
    if v_card.archived_at is null then return v_card; end if;
    update public.service_kanban_cards set archived_at = null, archived_by = null, updated_at = now() where id = v_card.id returning * into v_card;
  else raise exception using errcode = '22023', message = 'invalid kanban action'; end if;
  insert into public.service_kanban_card_events(organization_id, card_id, action, from_board_id, to_board_id, from_responsible_barber_id, to_responsible_barber_id, actor_user_id)
  values (p_organization_id, v_card.id, p_action, v_old_board, v_card.board_id, v_old_responsible, v_card.responsible_barber_id, auth.uid());
  return v_card;
end $$;

create function public.save_service_kanban_card_details(
  p_organization_id uuid, p_card_id uuid, p_title text, p_description text, p_due_on date
)
returns public.service_kanban_cards language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_card public.service_kanban_cards;
  v_actor_name text;
  v_previous_due_on date;
begin
  if not public.organization_module_enabled(p_organization_id, 'kanban') then
    raise exception using errcode = '42501', message = 'kanban module inactive';
  end if;
  select * into strict v_card from public.service_kanban_cards where id = p_card_id and organization_id = p_organization_id for update;
  if v_card.archived_at is not null then raise exception using errcode = '22023', message = 'archived card cannot be edited'; end if;
  if not public.is_organization_owner(p_organization_id) and not exists (
    select 1 from public.barbers where id = v_card.responsible_barber_id and organization_id = p_organization_id
      and auth_user_id = auth.uid() and active and app_access_enabled
  ) then raise exception using errcode = '42501', message = 'kanban card access denied'; end if;
  if v_card.appointment_id is null and char_length(btrim(coalesce(p_title, v_card.title))) not between 2 and 160 then
    raise exception using errcode = '22023', message = 'card title must have 2 to 160 characters';
  end if;
  select coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(b.display_name), ''), 'Gestor')
    into v_actor_name from public.profiles p left join public.barbers b on b.auth_user_id = auth.uid() and b.organization_id = p_organization_id
   where p.id = auth.uid();
  v_previous_due_on := v_card.due_on;
  update public.service_kanban_cards
     set title = case when appointment_id is null then btrim(coalesce(p_title, title)) else title end,
         description = nullif(btrim(p_description), ''), due_on = p_due_on, updated_at = now()
   where id = v_card.id returning * into v_card;
  if p_due_on is not null and v_previous_due_on is distinct from p_due_on then
    insert into public.service_kanban_card_comments(organization_id, card_id, body, author_user_id, author_name)
    values (p_organization_id, v_card.id, 'Data prazo alterada', auth.uid(), coalesce(v_actor_name, 'Gestor'));
  end if;
  insert into public.service_kanban_card_events(organization_id, card_id, action, from_board_id, to_board_id, from_responsible_barber_id, to_responsible_barber_id, actor_user_id)
  values (p_organization_id, v_card.id, 'EDITED', v_card.board_id, v_card.board_id, v_card.responsible_barber_id, v_card.responsible_barber_id, auth.uid());
  return v_card;
end $$;

create function public.save_service_kanban_card_links(p_organization_id uuid, p_card_id uuid, p_links jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_card public.service_kanban_cards;
  v_role text;
  v_link jsonb;
  v_label text;
  v_url text;
begin
  if not public.organization_module_enabled(p_organization_id, 'kanban') then
    raise exception using errcode = '42501', message = 'kanban module inactive';
  end if;
  select * into strict v_card from public.service_kanban_cards where id = p_card_id and organization_id = p_organization_id for update;
  if v_card.archived_at is not null then raise exception using errcode = '22023', message = 'archived card cannot be edited'; end if;
  if public.is_organization_owner(p_organization_id) then v_role := 'OWNER';
  elsif exists (select 1 from public.barbers where id = v_card.responsible_barber_id and organization_id = p_organization_id and auth_user_id = auth.uid() and active and app_access_enabled) then v_role := 'BARBER';
  else raise exception using errcode = '42501', message = 'kanban card access denied'; end if;
  if p_links is null or jsonb_typeof(p_links) <> 'array' or jsonb_array_length(p_links) > 3 then
    raise exception using errcode = '22023', message = 'up to three card links are allowed';
  end if;
  delete from public.service_kanban_card_links where organization_id = p_organization_id and card_id = v_card.id and created_by_role = v_role;
  for v_link in select value from jsonb_array_elements(p_links) loop
    v_label := nullif(btrim(v_link ->> 'label'), '');
    v_url := nullif(btrim(v_link ->> 'url'), '');
    if v_label is null and v_url is null then continue; end if;
    if v_label is null or char_length(v_label) > 120 or v_url is null or char_length(v_url) > 2048 or v_url !~* '^https?://' then
      raise exception using errcode = '22023', message = 'card link requires a title and a valid http or https URL';
    end if;
    insert into public.service_kanban_card_links(organization_id, card_id, label, url, created_by_user_id, created_by_role)
    values (p_organization_id, v_card.id, v_label, v_url, auth.uid(), v_role);
  end loop;
end $$;

create function public.save_service_kanban_card_comment(
  p_organization_id uuid, p_card_id uuid, p_comment_id uuid, p_body text
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_card public.service_kanban_cards;
  v_comment_id uuid;
  v_author_name text;
begin
  if not public.organization_module_enabled(p_organization_id, 'kanban') then
    raise exception using errcode = '42501', message = 'kanban module inactive';
  end if;
  select * into strict v_card from public.service_kanban_cards where id = p_card_id and organization_id = p_organization_id for update;
  if v_card.archived_at is not null then raise exception using errcode = '22023', message = 'archived card cannot be edited'; end if;
  if not public.is_organization_owner(p_organization_id) and not exists (
    select 1 from public.barbers where id = v_card.responsible_barber_id and organization_id = p_organization_id
      and auth_user_id = auth.uid() and active and app_access_enabled
  ) then raise exception using errcode = '42501', message = 'kanban card access denied'; end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 5000 then
    raise exception using errcode = '22023', message = 'comment must have 1 to 5000 characters';
  end if;
  select coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(b.display_name), ''), 'Gestor')
    into v_author_name from public.profiles p left join public.barbers b on b.auth_user_id = auth.uid() and b.organization_id = p_organization_id
   where p.id = auth.uid();
  if p_comment_id is null then
    insert into public.service_kanban_card_comments(organization_id, card_id, body, author_user_id, author_name)
    values (p_organization_id, v_card.id, btrim(p_body), auth.uid(), coalesce(v_author_name, 'Gestor')) returning id into v_comment_id;
  else
    update public.service_kanban_card_comments set body = btrim(p_body), updated_at = now()
     where id = p_comment_id and organization_id = p_organization_id and card_id = v_card.id
       and (author_user_id = auth.uid() or public.is_organization_owner(p_organization_id))
     returning id into v_comment_id;
    if v_comment_id is null then raise exception using errcode = '42501', message = 'comment update denied'; end if;
  end if;
  return v_comment_id;
end $$;

revoke all on function public.create_manual_service_kanban_card(uuid, text, uuid, uuid, uuid, text),
  public.mutate_service_kanban_card(uuid, uuid, text, uuid, text),
  public.save_service_kanban_card_details(uuid, uuid, text, text, date),
  public.save_service_kanban_card_links(uuid, uuid, jsonb),
  public.save_service_kanban_card_comment(uuid, uuid, uuid, text)
  from public, anon;
grant execute on function public.create_manual_service_kanban_card(uuid, text, uuid, uuid, uuid, text),
  public.mutate_service_kanban_card(uuid, uuid, text, uuid, text),
  public.save_service_kanban_card_details(uuid, uuid, text, text, date),
  public.save_service_kanban_card_links(uuid, uuid, jsonb),
  public.save_service_kanban_card_comment(uuid, uuid, uuid, text)
  to authenticated;
