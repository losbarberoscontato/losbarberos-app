-- A package can deliberately use a shorter or longer appointment block than
-- the sum of its services. Existing packages retain their current derived
-- duration so historical appointments and package composition stay intact.
alter table public.packages
  add column duration_minutes integer
    check (duration_minutes between 5 and 14400);

update public.packages p
set duration_minutes = derived.duration_minutes
from (
  select pi.organization_id, pi.package_id,
    sum(s.duration_minutes * pi.quantity)::integer as duration_minutes
  from public.package_items pi
  join public.services s
    on s.id = pi.service_id and s.organization_id = pi.organization_id
  where pi.active
  group by pi.organization_id, pi.package_id
) derived
where p.id = derived.package_id
  and p.organization_id = derived.organization_id
  and p.duration_minutes is null;

create or replace function public.save_package_with_items_v3(
  p_organization_id uuid,
  p_package_id uuid,
  p_name text,
  p_description text,
  p_price_cents bigint,
  p_duration_minutes integer,
  p_active boolean,
  p_sort_order integer,
  p_audiences text[],
  p_items jsonb,
  p_accepts_subscription boolean,
  p_accepts_online_payment boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_package_id uuid;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization owner required';
  end if;
  if not public.organization_allows_management_mutations(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization access does not allow catalog changes';
  end if;
  if p_duration_minutes not between 5 and 14400 then
    raise exception using errcode = '22023', message = 'package duration must be between 5 and 14400 minutes';
  end if;

  v_package_id := public.save_package_with_items_v2(
    p_organization_id, p_package_id, p_name, p_description, p_price_cents,
    p_active, p_sort_order, p_audiences, p_items,
    p_accepts_subscription, p_accepts_online_payment
  );

  update public.packages
  set duration_minutes = p_duration_minutes
  where id = v_package_id and organization_id = p_organization_id;
  return v_package_id;
end;
$$;

revoke all on function public.save_package_with_items_v3(uuid, uuid, text, text, bigint, integer, boolean, integer, text[], jsonb, boolean, boolean) from public, anon, authenticated, service_role;
grant execute on function public.save_package_with_items_v3(uuid, uuid, text, text, bigint, integer, boolean, integer, text[], jsonb, boolean, boolean) to authenticated;

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
  v_package public.packages%rowtype;
  v_item record;
  v_existing public.appointment_items%rowtype;
  v_commission jsonb;
  v_items jsonb := '[]'::jsonb;
  v_selection_key uuid;
  v_service_id uuid;
  v_package_id uuid;
  v_preserved_key uuid;
  v_quantity integer;
  v_total bigint := 0;
  v_list_total bigint := 0;
  v_duration integer := 0;
  v_package_derived_duration integer;
  v_position integer := 0;
  v_package_allocated bigint;
  v_line_list bigint;
  v_line_charge bigint;
  v_found integer;
begin
  if jsonb_typeof(p_selections) <> 'array' or jsonb_array_length(p_selections) = 0 then
    raise exception using errcode = '22023', message = 'selections must be a non-empty JSON array';
  end if;
  if not exists (
    select 1 from public.barbers b
    where b.id = p_barber_id and b.organization_id = p_organization_id and b.active
  ) then
    raise exception using errcode = 'P0002', message = 'active barber not found';
  end if;

  for v_selection in select value from jsonb_array_elements(p_selections)
  loop
    if v_selection ? 'preserved_selection_key' then
      if p_appointment_id is null then
        raise exception using errcode = '22023', message = 'preserved selection requires appointment';
      end if;
      v_preserved_key := (v_selection ->> 'preserved_selection_key')::uuid;
      v_found := 0;
      for v_existing in
        select * from public.appointment_items ai
        where ai.organization_id = p_organization_id
          and ai.appointment_id = p_appointment_id
          and ai.selection_key = v_preserved_key
        order by ai.position
      loop
        if not exists (
          select 1 from public.barber_services bs
          where bs.organization_id = p_organization_id
            and bs.barber_id = p_barber_id
            and bs.service_id = v_existing.service_id
            and bs.active
        ) then
          raise exception using errcode = '22023', message = 'barber cannot perform preserved service';
        end if;
        v_position := v_position + 1;
        v_found := v_found + 1;
        v_items := v_items || jsonb_build_array(jsonb_build_object(
          'id', v_existing.id, 'selection_key', v_existing.selection_key,
          'source', v_existing.source, 'service_id', v_existing.service_id,
          'package_id', v_existing.package_id, 'package_item_id', v_existing.package_item_id,
          'service_name', v_existing.service_name_snapshot, 'quantity', v_existing.quantity,
          'charged_price_cents', v_existing.charged_price_cents_snapshot,
          'list_price_cents', v_existing.list_price_cents_snapshot,
          'duration_minutes', v_existing.duration_minutes_snapshot,
          'commission_mode', v_existing.commission_mode_snapshot,
          'commission_percentage_bps', v_existing.commission_percentage_bps_snapshot,
          'commission_fixed_cents', v_existing.commission_fixed_cents_snapshot,
          'position', v_position
        ));
        v_total := v_total + v_existing.charged_price_cents_snapshot;
        v_list_total := v_list_total + v_existing.list_price_cents_snapshot;
        v_duration := v_duration + v_existing.duration_minutes_snapshot;
      end loop;
      if v_found = 0 then
        raise exception using errcode = 'P0002', message = 'preserved selection not found';
      end if;

    elsif upper(coalesce(v_selection ->> 'type', '')) = 'SERVICE' then
      v_service_id := coalesce(v_selection ->> 'service_id', v_selection ->> 'id')::uuid;
      v_quantity := coalesce((v_selection ->> 'quantity')::integer, 1);
      if v_quantity not between 1 and 20 then
        raise exception using errcode = '22023', message = 'service quantity must be between 1 and 20';
      end if;
      select * into strict v_service
      from public.services s
      where s.id = v_service_id and s.organization_id = p_organization_id and s.active;
      if not exists (
        select 1 from public.barber_services bs
        where bs.organization_id = p_organization_id
          and bs.barber_id = p_barber_id and bs.service_id = v_service.id and bs.active
      ) then
        raise exception using errcode = '22023', message = 'barber cannot perform selected service';
      end if;
      v_selection_key := gen_random_uuid();
      v_commission := public.commission_snapshot_for(p_organization_id, p_barber_id, v_service.id);
      v_position := v_position + 1;
      v_line_list := v_service.price_cents * v_quantity;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid(), 'selection_key', v_selection_key, 'source', 'SERVICE',
        'service_id', v_service.id, 'package_id', null, 'package_item_id', null,
        'service_name', v_service.name, 'quantity', v_quantity,
        'charged_price_cents', v_line_list, 'list_price_cents', v_line_list,
        'duration_minutes', v_service.duration_minutes * v_quantity,
        'commission_mode', v_commission ->> 'mode',
        'commission_percentage_bps', v_commission -> 'percentage_bps',
        'commission_fixed_cents', v_commission -> 'fixed_cents',
        'position', v_position
      ));
      v_total := v_total + v_line_list;
      v_list_total := v_list_total + v_line_list;
      v_duration := v_duration + (v_service.duration_minutes * v_quantity);

    elsif upper(coalesce(v_selection ->> 'type', '')) = 'PACKAGE' then
      v_package_id := coalesce(v_selection ->> 'package_id', v_selection ->> 'id')::uuid;
      select * into strict v_package
      from public.packages p
      where p.id = v_package_id and p.organization_id = p_organization_id and p.active;
      v_selection_key := gen_random_uuid();
      v_package_allocated := 0;
      v_package_derived_duration := 0;
      v_found := 0;
      for v_item in
        select
          pi.id as package_item_id, pi.quantity, pi.position as item_position,
          s.id as service_id, s.name as service_name, s.price_cents, s.duration_minutes,
          row_number() over (order by pi.position, pi.id) as line_number,
          count(*) over () as line_count,
          sum(s.price_cents * pi.quantity) over ()::bigint as package_list_total
        from public.package_items pi
        join public.services s
          on s.id = pi.service_id and s.organization_id = pi.organization_id
        where pi.package_id = v_package.id
          and pi.organization_id = p_organization_id
          and pi.active and s.active
        order by pi.position, pi.id
      loop
        v_found := v_found + 1;
        if not exists (
          select 1 from public.barber_services bs
          where bs.organization_id = p_organization_id
            and bs.barber_id = p_barber_id and bs.service_id = v_item.service_id and bs.active
        ) then
          raise exception using errcode = '22023', message = 'barber cannot perform package service';
        end if;
        v_line_list := v_item.price_cents * v_item.quantity;
        if v_item.package_list_total = 0 then
          v_line_charge := case when v_item.line_number = v_item.line_count
            then v_package.price_cents - v_package_allocated else 0 end;
        elsif v_item.line_number = v_item.line_count then
          v_line_charge := v_package.price_cents - v_package_allocated;
        else
          v_line_charge := floor(
            v_package.price_cents::numeric * v_line_list::numeric / v_item.package_list_total::numeric
          )::bigint;
        end if;
        v_package_allocated := v_package_allocated + v_line_charge;
        v_commission := public.commission_snapshot_for(p_organization_id, p_barber_id, v_item.service_id);
        v_position := v_position + 1;
        v_items := v_items || jsonb_build_array(jsonb_build_object(
          'id', gen_random_uuid(), 'selection_key', v_selection_key, 'source', 'PACKAGE',
          'service_id', v_item.service_id, 'package_id', v_package.id,
          'package_item_id', v_item.package_item_id, 'service_name', v_item.service_name,
          'quantity', v_item.quantity, 'charged_price_cents', v_line_charge,
          'list_price_cents', v_line_list,
          'duration_minutes', v_item.duration_minutes * v_item.quantity,
          'commission_mode', v_commission ->> 'mode',
          'commission_percentage_bps', v_commission -> 'percentage_bps',
          'commission_fixed_cents', v_commission -> 'fixed_cents',
          'position', v_position
        ));
        v_list_total := v_list_total + v_line_list;
        v_package_derived_duration := v_package_derived_duration + (v_item.duration_minutes * v_item.quantity);
      end loop;
      if v_found = 0 then
        raise exception using errcode = '22023', message = 'package has no active items';
      end if;
      v_duration := v_duration + coalesce(v_package.duration_minutes, v_package_derived_duration);
      v_total := v_total + v_package.price_cents;
    else
      raise exception using errcode = '22023', message = 'selection type must be SERVICE or PACKAGE';
    end if;
  end loop;

  return jsonb_build_object(
    'items', v_items,
    'total_cents', v_total,
    'list_total_cents', v_list_total,
    'duration_minutes', v_duration
  );
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'selected service or package not found';
end;
$$;

create or replace function public.get_public_booking_context(p_organization_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
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
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'description', s.description, 'price_cents', s.price_cents, 'duration_minutes', s.duration_minutes, 'audiences', s.audiences) order by s.sort_order, s.name) from public.services s where s.organization_id = o.id and s.active and cardinality(s.audiences) > 0), '[]'::jsonb),
    'packages', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'description', p.description, 'price_cents', p.price_cents, 'duration_minutes', p.duration_minutes, 'audiences', p.audiences, 'items', coalesce((select jsonb_agg(jsonb_build_object('service_id', s.id, 'name', s.name, 'quantity', pi.quantity, 'duration_minutes', s.duration_minutes) order by pi.position, s.name) from public.package_items pi join public.services s on s.id = pi.service_id and s.organization_id = pi.organization_id where pi.package_id = p.id and pi.organization_id = p.organization_id and pi.active and s.active and cardinality(s.audiences) > 0), '[]'::jsonb)) order by p.sort_order, p.name) from public.packages p where p.organization_id = o.id and p.active and cardinality(p.audiences) > 0 and exists (select 1 from public.package_items pi join public.services s on s.id = pi.service_id and s.organization_id = pi.organization_id where pi.package_id = p.id and pi.organization_id = p.organization_id and pi.active and s.active and cardinality(s.audiences) > 0)), '[]'::jsonb),
    'barbers', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.display_name, 'bio', b.bio, 'avatar_url', b.avatar_url, 'service_ids', coalesce((select jsonb_agg(bs.service_id order by bs.service_id) from public.barber_services bs join public.services s on s.id = bs.service_id and s.organization_id = bs.organization_id where bs.organization_id = b.organization_id and bs.barber_id = b.id and bs.active and s.active), '[]'::jsonb)) order by b.display_name) from public.barbers b where b.organization_id = o.id and b.active), '[]'::jsonb)
  ) from public.organizations o where o.slug = p_organization_slug;
$$;

revoke all on function public.get_public_booking_context(text) from public;
grant execute on function public.get_public_booking_context(text) to anon, authenticated;
