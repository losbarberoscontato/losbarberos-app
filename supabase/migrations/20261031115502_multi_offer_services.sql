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
      or (v_offer ? 'description' and jsonb_typeof(v_offer->'description') not in ('string', 'null')) then
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

alter table public.services add column offers jsonb not null default '[]'::jsonb;
alter table public.services add constraint services_offers_valid check (public.service_offers_valid(offers));

-- Offers are public only through the existing tenant-scoped booking context.
create or replace function public.get_public_booking_context(p_organization_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with requested_slug as (select lower(btrim(p_organization_slug)) as slug)
  select jsonb_build_object(
    'organization', jsonb_build_object(
      'id', o.id, 'name', o.name, 'slug', o.slug, 'timezone', o.timezone,
      'currency', o.currency, 'deposit_bps', o.deposit_bps,
      'cancellation_lead_minutes', o.cancellation_lead_minutes,
      'accepting_bookings', public.organization_accepts_new_bookings(o.id),
      'booking_public_id', o.booking_public_id, 'logo_path', o.logo_path,
      'public_contact_phone_e164', o.public_contact_phone_e164
    ),
    'location', (select jsonb_build_object('id', l.id, 'name', l.name, 'address', l.address) from public.locations l where l.organization_id = o.id and l.active limit 1),
    'audiences', coalesce((select jsonb_agg(jsonb_build_object('audience_key', a.audience_key, 'name', a.name, 'active', a.active, 'sort_order', a.sort_order, 'is_default', a.is_default) order by a.sort_order, a.name) from public.organization_audiences a where a.organization_id = o.id and a.active), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'description', s.description, 'price_cents', s.price_cents, 'duration_minutes', s.duration_minutes, 'offers', s.offers,
      'audiences', array(select selected.audience_key from unnest(s.audiences) as selected(audience_key) join public.organization_audiences a on a.organization_id = s.organization_id and a.audience_key = selected.audience_key and a.active order by a.sort_order, a.name)) order by s.sort_order, s.name)
      from public.services s where s.organization_id = o.id and s.active and s.availability = 'CLIENT' and exists (select 1 from unnest(s.audiences) selected(audience_key) join public.organization_audiences a on a.organization_id = s.organization_id and a.audience_key = selected.audience_key and a.active)), '[]'::jsonb),
    'packages', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'description', p.description, 'price_cents', p.price_cents, 'duration_minutes', p.duration_minutes,
      'audiences', array(select selected.audience_key from unnest(p.audiences) as selected(audience_key) join public.organization_audiences a on a.organization_id = p.organization_id and a.audience_key = selected.audience_key and a.active order by a.sort_order, a.name),
      'items', coalesce((select jsonb_agg(jsonb_build_object('service_id', s.id, 'name', s.name, 'quantity', pi.quantity, 'duration_minutes', s.duration_minutes) order by pi.position, s.name)
        from public.package_items pi join public.services s on s.id = pi.service_id and s.organization_id = pi.organization_id
        where pi.package_id = p.id and pi.organization_id = p.organization_id and pi.active and s.active and s.availability = 'CLIENT'
          and exists (select 1 from unnest(s.audiences) selected(audience_key) join public.organization_audiences a on a.organization_id = s.organization_id and a.audience_key = selected.audience_key and a.active)), '[]'::jsonb)) order by p.sort_order, p.name)
      from public.packages p where p.organization_id = o.id and p.active
        and exists (select 1 from unnest(p.audiences) selected(audience_key) join public.organization_audiences a on a.organization_id = p.organization_id and a.audience_key = selected.audience_key and a.active)
        and exists (select 1 from public.package_items pi join public.services s on s.id = pi.service_id and s.organization_id = pi.organization_id
          where pi.package_id = p.id and pi.organization_id = p.organization_id and pi.active and s.active and s.availability = 'CLIENT'
            and exists (select 1 from unnest(s.audiences) selected(audience_key) join public.organization_audiences a on a.organization_id = s.organization_id and a.audience_key = selected.audience_key and a.active))), '[]'::jsonb),
    'barbers', coalesce((select jsonb_agg(jsonb_build_object(
      'id', b.id, 'name', b.display_name, 'bio', b.bio, 'avatar_url', b.avatar_url,
      'service_ids', coalesce((select jsonb_agg(bs.service_id order by bs.service_id) from public.barber_services bs join public.services s on s.id = bs.service_id and s.organization_id = bs.organization_id
        where bs.organization_id = b.organization_id and bs.barber_id = b.id and bs.active and s.active and s.availability = 'CLIENT'), '[]'::jsonb),
      'package_ids', coalesce((select jsonb_agg(bp.package_id order by bp.package_id) from public.barber_packages bp where bp.organization_id = b.organization_id and bp.barber_id = b.id and bp.active), '[]'::jsonb),
      'subscription_plan_ids', coalesce((select jsonb_agg(bsp.plan_id order by bsp.plan_id) from public.barber_subscription_plans bsp where bsp.organization_id = b.organization_id and bsp.barber_id = b.id and bsp.active), '[]'::jsonb)
    ) order by b.display_name) from public.barbers b where b.organization_id = o.id and b.active), '[]'::jsonb)
  ) from public.organizations o cross join requested_slug r
  left join public.organization_slug_aliases a on a.organization_id = o.id and a.slug = r.slug
  where o.slug = r.slug or a.slug is not null;
$$;

revoke all on function public.get_public_booking_context(text) from public;
grant execute on function public.get_public_booking_context(text) to anon, authenticated;

alter function public.resolve_booking_selection(uuid, uuid, jsonb, uuid)
  rename to resolve_booking_selection_before_service_offers;
revoke all on function public.resolve_booking_selection_before_service_offers(uuid, uuid, jsonb, uuid) from public, anon;

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
      'service_name', v_service.name || ' — Oferta ' || v_offer_number,
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
