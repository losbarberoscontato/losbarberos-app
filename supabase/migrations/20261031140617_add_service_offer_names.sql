begin;

create or replace function public.service_offers_valid(p_offers jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_offer jsonb;
  v_id text;
  v_ids text[] := array[]::text[];
  v_price numeric;
  v_duration numeric;
begin
  if p_offers is null or jsonb_typeof(p_offers) <> 'array' then return false; end if;
  if jsonb_array_length(p_offers) = 0 then return true; end if;
  if jsonb_array_length(p_offers) < 2 then return false; end if;
  for v_offer in select value from jsonb_array_elements(p_offers)
  loop
    if jsonb_typeof(v_offer) <> 'object' or jsonb_typeof(v_offer->'id') <> 'string'
      or jsonb_typeof(v_offer->'price_cents') <> 'number'
      or jsonb_typeof(v_offer->'duration_minutes') <> 'number'
      or (v_offer ? 'description' and jsonb_typeof(v_offer->'description') not in ('string', 'null'))
      or (v_offer ? 'name' and (jsonb_typeof(v_offer->'name') is distinct from 'string' or btrim(v_offer->>'name') = '')) then
      return false;
    end if;
    v_id := btrim(v_offer->>'id');
    v_price := (v_offer->>'price_cents')::numeric;
    v_duration := (v_offer->>'duration_minutes')::numeric;
    if v_id = '' or v_id = any(v_ids) or v_price < 0 or trunc(v_price) <> v_price
      or v_duration < 5 or v_duration > 720 or trunc(v_duration) <> v_duration then
      return false;
    end if;
    v_ids := array_append(v_ids, v_id);
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

create or replace function public.resolve_booking_selection(
  p_organization_id uuid,
  p_barber_id uuid,
  p_selections jsonb,
  p_appointment_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_selection jsonb;
  v_service public.services%rowtype;
  v_offer jsonb;
  v_offer_number integer;
  v_items jsonb;
  v_item jsonb;
  v_new_item jsonb;
  v_item_index integer;
  v_index integer;
  v_quantity integer;
  v_new_price bigint;
  v_new_duration integer;
  v_resolution jsonb;
begin
  if jsonb_typeof(p_selections) <> 'array' or jsonb_array_length(p_selections) = 0 then
    raise exception using errcode = '22023', message = 'selections must be a non-empty JSON array';
  end if;

  v_resolution := public.resolve_booking_selection_before_service_offers(
    p_organization_id, p_barber_id, p_selections, p_appointment_id
  );
  v_items := v_resolution->'items';

  for v_selection in select value from jsonb_array_elements(p_selections)
    where upper(coalesce(value->>'type', '')) = 'SERVICE' and value ? 'offer_id'
  loop
    select * into strict v_service from public.services s
      where s.id = coalesce(v_selection->>'service_id', v_selection->>'id')::uuid
        and s.organization_id = p_organization_id and s.active;
    select offers.value, offers.ordinality::integer into strict v_offer, v_offer_number
      from jsonb_array_elements(v_service.offers) with ordinality as offers(value, ordinality)
      where offers.value->>'id' = v_selection->>'offer_id';

    v_item_index := null;
    for v_index in 0..jsonb_array_length(v_items) - 1 loop
      v_item := v_items->v_index;
      if v_item->>'source' = 'SERVICE'
        and v_item->>'service_id' = v_service.id::text
        and not (v_item ? 'service_offer_id') then
        v_item_index := v_index;
        exit;
      end if;
    end loop;
    if v_item_index is null then
      raise exception using errcode = '22023', message = 'selected service offer does not match booking selection';
    end if;

    v_item := v_items->v_item_index;
    v_quantity := (v_item->>'quantity')::integer;
    v_new_price := (v_offer->>'price_cents')::bigint;
    v_new_duration := (v_offer->>'duration_minutes')::integer;
    v_new_item := v_item || jsonb_build_object(
      'service_name', v_service.name || ' — ' || coalesce(nullif(btrim(v_offer->>'name'), ''), 'Oferta ' || v_offer_number::text),
      'charged_price_cents', v_new_price * v_quantity,
      'list_price_cents', v_new_price * v_quantity,
      'duration_minutes', v_new_duration * v_quantity,
      'service_offer_id', v_offer->>'id'
    );
    v_resolution := jsonb_set(v_resolution, '{total_cents}', to_jsonb((v_resolution->>'total_cents')::bigint - (v_item->>'charged_price_cents')::bigint + v_new_price * v_quantity));
    v_resolution := jsonb_set(v_resolution, '{list_total_cents}', to_jsonb((v_resolution->>'list_total_cents')::bigint - (v_item->>'list_price_cents')::bigint + v_new_price * v_quantity));
    v_resolution := jsonb_set(v_resolution, '{duration_minutes}', to_jsonb((v_resolution->>'duration_minutes')::integer - (v_item->>'duration_minutes')::integer + v_new_duration * v_quantity));
    v_items := jsonb_set(v_items, array[v_item_index::text], v_new_item);
    v_resolution := jsonb_set(v_resolution, '{items}', v_items);
  end loop;

  return v_resolution;
exception
  when no_data_found then raise exception using errcode = '22023', message = 'selected service offer not found';
end;
$$;

revoke all on function public.resolve_booking_selection(uuid, uuid, jsonb, uuid) from public, anon;
grant execute on function public.resolve_booking_selection(uuid, uuid, jsonb, uuid) to authenticated, service_role;

commit;
