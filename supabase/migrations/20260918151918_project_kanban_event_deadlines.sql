-- Dados operacionais exibidos nos cards do Kanban.
alter table public.project_engagements
  add column if not exists kanban_received_at timestamptz,
  add column if not exists kanban_received_by uuid,
  add column if not exists kanban_received_by_name text,
  add column if not exists event_due_on date;

alter table public.project_engagements
  add constraint project_engagements_kanban_received_by_fk
  foreign key (kanban_received_by) references auth.users(id);

create index project_engagements_kanban_card_idx
  on public.project_engagements (organization_id, kanban_board_id, event_due_on, kanban_received_at desc);

update public.project_engagements e
   set kanban_received_at = coalesce(e.kanban_received_at, e.updated_at, e.created_at, now()),
       kanban_received_by = coalesce(e.kanban_received_by, e.created_by),
       kanban_received_by_name = coalesce(
         nullif(btrim(e.kanban_received_by_name), ''),
         (select nullif(btrim(p.display_name), '') from public.profiles p where p.id = e.created_by),
         'Usuário'
       )
 where e.kanban_received_at is null
    or e.kanban_received_by is null
    or e.kanban_received_by_name is null;

-- Novas contratações recebem o registro inicial do usuário e do horário.
create or replace function public.assign_project_engagement_kanban_board()
returns trigger
language plpgsql
as $$
declare
  v_author_name text;
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
  if new.kanban_received_at is null then new.kanban_received_at := now(); end if;
  if new.kanban_received_by is null then new.kanban_received_by := coalesce(new.created_by, auth.uid()); end if;
  if new.kanban_received_by_name is null then
    select nullif(btrim(p.display_name), '') into v_author_name from public.profiles p where p.id = new.kanban_received_by;
    new.kanban_received_by_name := coalesce(v_author_name, nullif(btrim(auth.jwt() ->> 'email'), ''), 'Usuário');
  end if;
  return new;
end;
$$;

-- Alterar o quadro reinicia o prazo e registra o novo responsável pelo recebimento.
create or replace function public.move_project_engagement_to_kanban_board(
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
  v_author_name text;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'kanban engagement access denied';
  end if;
  if not public.organization_module_enabled(p_organization_id, 'projects') then
    raise exception using errcode = '42501', message = 'projects module disabled';
  end if;
  if not exists (
    select 1 from public.project_kanban_boards b
     where b.id = p_destination_board_id and b.organization_id = p_organization_id
       and b.project_id = p_project_id and b.active
  ) then
    raise exception using errcode = '22023', message = 'destination kanban board is invalid';
  end if;
  select * into v_engagement from public.project_engagements e
   where e.id = p_engagement_id and e.organization_id = p_organization_id and e.project_id = p_project_id
   for update;
  if not found then raise exception using errcode = 'P0002', message = 'project engagement not found'; end if;
  if v_engagement.kanban_board_id <> p_destination_board_id then
    select coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(auth.jwt() ->> 'email'), ''), 'Usuário')
      into v_author_name from public.profiles p where p.id = auth.uid();
    update public.project_engagements
       set kanban_board_id = p_destination_board_id,
           kanban_received_at = now(),
           kanban_received_by = auth.uid(),
           kanban_received_by_name = coalesce(v_author_name, nullif(btrim(auth.jwt() ->> 'email'), ''), 'Usuário'),
           event_due_on = null,
           updated_at = now()
     where id = p_engagement_id and organization_id = p_organization_id and project_id = p_project_id
     returning * into v_engagement;
  end if;
  return v_engagement;
end;
$$;

revoke all on function public.move_project_engagement_to_kanban_board(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.move_project_engagement_to_kanban_board(uuid, uuid, uuid, uuid) to authenticated;

create or replace function public.move_project_engagement_to_kanban_sector(
  p_organization_id uuid,
  p_project_id uuid,
  p_engagement_id uuid,
  p_destination_sector_id uuid
)
returns public.project_engagements
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_engagement public.project_engagements;
  v_board public.project_kanban_boards;
  v_author_name text;
begin
  if not public.is_organization_owner(p_organization_id) then raise exception using errcode = '42501', message = 'kanban engagement access denied'; end if;
  if not public.organization_module_enabled(p_organization_id, 'projects') then raise exception using errcode = '42501', message = 'projects module disabled'; end if;
  if not exists (select 1 from public.project_kanban_sectors where id = p_destination_sector_id and organization_id = p_organization_id and active) then raise exception using errcode = '22023', message = 'destination kanban sector is invalid'; end if;
  select * into v_engagement from public.project_engagements where id = p_engagement_id and organization_id = p_organization_id and project_id = p_project_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'project engagement not found'; end if;
  select * into v_board from public.project_kanban_boards where project_id = p_project_id and organization_id = p_organization_id and sector_id = p_destination_sector_id and active order by position, created_at limit 1;
  if not found then raise exception using errcode = '22023', message = 'destination sector has no board in this project'; end if;
  if v_engagement.kanban_board_id <> v_board.id then
    select coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(auth.jwt() ->> 'email'), ''), 'Usuário')
      into v_author_name from public.profiles p where p.id = auth.uid();
    update public.project_engagements
       set kanban_board_id = v_board.id,
           kanban_received_at = now(),
           kanban_received_by = auth.uid(),
           kanban_received_by_name = coalesce(v_author_name, nullif(btrim(auth.jwt() ->> 'email'), ''), 'Usuário'),
           event_due_on = null,
           updated_at = now()
     where id = v_engagement.id and organization_id = p_organization_id returning * into v_engagement;
  end if;
  return v_engagement;
end;
$$;

revoke all on function public.move_project_engagement_to_kanban_sector(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.move_project_engagement_to_kanban_sector(uuid, uuid, uuid, uuid) to authenticated;

-- O prazo é salvo junto aos detalhes do evento; cada novo prazo deixa um comentário automático.
drop function public.save_project_engagement_event(uuid, uuid, uuid, text, text, text, text);
create function public.save_project_engagement_event(
  p_organization_id uuid,
  p_project_id uuid,
  p_engagement_id uuid,
  p_description text,
  p_link_1 text,
  p_link_2 text,
  p_link_3 text,
  p_due_on date
) returns public.project_engagements
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_engagement public.project_engagements;
  v_previous_due_on date;
  v_author_name text;
begin
  if not public.is_organization_owner(p_organization_id) then raise exception using errcode = '42501', message = 'project event write denied'; end if;
  if not public.organization_module_enabled(p_organization_id, 'projects') then raise exception using errcode = '42501', message = 'projects module disabled'; end if;
  select * into v_engagement from public.project_engagements where id = p_engagement_id and organization_id = p_organization_id and project_id = p_project_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'project engagement not found'; end if;
  v_previous_due_on := v_engagement.event_due_on;
  update public.project_engagements
     set event_description = nullif(btrim(p_description), ''),
         event_link_1 = nullif(btrim(p_link_1), ''),
         event_link_2 = nullif(btrim(p_link_2), ''),
         event_link_3 = nullif(btrim(p_link_3), ''),
         event_due_on = p_due_on,
         updated_at = now()
   where id = v_engagement.id and organization_id = p_organization_id returning * into v_engagement;
  if p_due_on is not null and v_previous_due_on is distinct from p_due_on then
    select coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(auth.jwt() ->> 'email'), ''), 'Usuário')
      into v_author_name from public.profiles p where p.id = auth.uid();
    insert into public.project_engagement_comments (organization_id, project_id, engagement_id, body, created_by, author_name)
    values (p_organization_id, p_project_id, p_engagement_id, 'Data prazo alterada', auth.uid(), coalesce(v_author_name, 'Usuário'));
  end if;
  return v_engagement;
end;
$$;

revoke all on function public.save_project_engagement_event(uuid, uuid, uuid, text, text, text, text, date) from public, anon;
grant execute on function public.save_project_engagement_event(uuid, uuid, uuid, text, text, text, text, date) to authenticated;
