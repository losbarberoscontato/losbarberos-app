alter table public.service_kanban_cards
  add column description text;

create function public.create_manual_service_kanban_card(
  p_organization_id uuid,
  p_title text,
  p_responsible_barber_id uuid,
  p_customer_id uuid,
  p_service_id uuid,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_board_id uuid;
  v_card_id uuid;
begin
  if not public.is_organization_owner(p_organization_id)
     or not public.organization_module_enabled(p_organization_id, 'kanban') then
    raise exception using errcode = '42501', message = 'kanban manager access denied';
  end if;

  if char_length(btrim(coalesce(p_title, ''))) not between 2 and 160 then
    raise exception using errcode = '22023', message = 'card title must have 2 to 160 characters';
  end if;

  if not exists (
    select 1 from public.barbers
    where id = p_responsible_barber_id
      and organization_id = p_organization_id
      and active and app_access_enabled
  ) then
    raise exception using errcode = '22023', message = 'responsible professional unavailable';
  end if;

  select id into strict v_board_id
  from public.service_kanban_boards
  where organization_id = p_organization_id and system_key = 'WAITING';

  insert into public.service_kanban_cards(
    organization_id, board_id, title, description,
    origin_barber_id, responsible_barber_id, customer_id, service_id
  )
  values (
    p_organization_id, v_board_id, btrim(p_title), nullif(btrim(p_description), ''),
    p_responsible_barber_id, p_responsible_barber_id, p_customer_id, p_service_id
  )
  returning id into v_card_id;

  insert into public.service_kanban_card_events(
    organization_id, card_id, action, to_board_id, to_responsible_barber_id, actor_user_id
  )
  values (p_organization_id, v_card_id, 'CREATED', v_board_id, p_responsible_barber_id, auth.uid());

  return v_card_id;
end;
$$;

revoke all on function public.create_manual_service_kanban_card(uuid, text, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.create_manual_service_kanban_card(uuid, text, uuid, uuid, uuid, text) to authenticated;
