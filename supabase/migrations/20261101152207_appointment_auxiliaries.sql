-- Auxiliares de atendimento: comissão própria, tenant-scoped e sem alterar preço cobrado.
insert into public.platform_modules(key, name, description)
values (
  'appointment_assistants',
  'Permitir profissional auxiliar em atendimentos',
  'Permite escalar até três profissionais auxiliares por atendimento e definir comissão por serviço, sem alterar o valor cobrado do cliente.'
)
on conflict (key) do update
set name = excluded.name, description = excluded.description, active = true, updated_at = now();

create or replace function public.set_appointment_assistants_module_enabled(
  p_organization_id uuid,
  p_enabled boolean
)
returns public.organization_module_entitlements
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old boolean;
  v_row public.organization_module_entitlements;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'module entitlement denied';
  end if;
  if not exists (
    select 1 from public.platform_modules
    where key = 'appointment_assistants' and active
  ) then
    raise exception using errcode = '22023', message = 'unknown or inactive module';
  end if;
  select enabled into v_old
  from public.organization_module_entitlements
  where organization_id = p_organization_id and module_key = 'appointment_assistants'
  for update;

  insert into public.organization_module_entitlements (
    organization_id, module_key, enabled, changed_by,
    billing_change_effective_at, billing_change_action, billing_sync_status
  ) values (
    p_organization_id, 'appointment_assistants', p_enabled, auth.uid(),
    null, 'NONE', 'SYNCED'
  ) on conflict (organization_id, module_key) do update set
    enabled = excluded.enabled,
    changed_by = excluded.changed_by,
    changed_at = now(),
    billing_change_effective_at = null,
    billing_change_action = 'NONE',
    billing_sync_status = 'SYNCED'
  returning * into v_row;

  if v_old is distinct from p_enabled then
    insert into public.organization_module_events (
      organization_id, module_key, from_enabled, to_enabled, actor_user_id, reason
    ) values (
      p_organization_id, 'appointment_assistants', v_old, p_enabled, auth.uid(),
      case when p_enabled then 'MANAGER_ENABLE_FREE_MODULE' else 'MANAGER_DISABLE_FREE_MODULE' end
    );
  end if;
  return v_row;
end;
$$;
revoke all on function public.set_appointment_assistants_module_enabled(uuid, boolean) from public, anon;
grant execute on function public.set_appointment_assistants_module_enabled(uuid, boolean) to authenticated;

create table public.appointment_auxiliaries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  appointment_id uuid not null,
  assistant_barber_id uuid not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, appointment_id, assistant_barber_id),
  foreign key (appointment_id, organization_id)
    references public.appointments(id, organization_id) on delete cascade,
  foreign key (assistant_barber_id, organization_id)
    references public.barbers(id, organization_id)
);

create table public.appointment_auxiliary_commission_rules (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  auxiliary_id uuid not null,
  appointment_item_id uuid not null,
  commission_mode public.commission_mode not null,
  fixed_cents bigint,
  percentage_bps integer,
  created_at timestamptz not null default now(),
  primary key (organization_id, auxiliary_id, appointment_item_id),
  foreign key (auxiliary_id, organization_id)
    references public.appointment_auxiliaries(id, organization_id) on delete cascade,
  foreign key (appointment_item_id, organization_id)
    references public.appointment_items(id, organization_id) on delete cascade,
  check (
    (commission_mode = 'FIXED' and fixed_cents >= 0 and percentage_bps is null)
    or (commission_mode = 'PERCENT' and percentage_bps between 0 and 10000 and fixed_cents is null)
  )
);

create index appointment_auxiliaries_appointment_idx
  on public.appointment_auxiliaries (organization_id, appointment_id);
create index appointment_auxiliaries_barber_idx
  on public.appointment_auxiliaries (organization_id, assistant_barber_id, created_at desc);

alter table public.appointment_auxiliaries enable row level security;
alter table public.appointment_auxiliary_commission_rules enable row level security;
create policy appointment_auxiliaries_manager_select on public.appointment_auxiliaries
  for select to authenticated using (public.is_organization_owner(organization_id));
create policy appointment_auxiliary_rules_manager_select on public.appointment_auxiliary_commission_rules
  for select to authenticated using (public.is_organization_owner(organization_id));
grant select on public.appointment_auxiliaries, public.appointment_auxiliary_commission_rules to authenticated;
revoke insert, update, delete on public.appointment_auxiliaries, public.appointment_auxiliary_commission_rules from anon, authenticated;

create or replace function public.save_appointment_auxiliaries(
  p_organization_id uuid,
  p_appointment_id uuid,
  p_auxiliaries jsonb
)
returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_appointment public.appointments%rowtype;
  v_aux jsonb;
  v_rule jsonb;
  v_auxiliary_id uuid;
  v_barber_id uuid;
  v_item_count integer;
  v_rule_count integer;
  v_unique_count integer;
  v_new_assignment boolean;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization owner required';
  end if;
  if not public.organization_module_enabled(p_organization_id, 'appointment_assistants') then
    raise exception using errcode = '42501', message = 'appointment assistants module disabled';
  end if;
  if jsonb_typeof(p_auxiliaries) is distinct from 'array' or jsonb_array_length(p_auxiliaries) > 3 then
    raise exception using errcode = '22023', message = 'at most three appointment auxiliaries are allowed';
  end if;

  select * into strict v_appointment
  from public.appointments
  where id = p_appointment_id and organization_id = p_organization_id
  for update;
  if v_appointment.status in ('COMPLETED', 'CANCELED', 'NO_SHOW', 'EXPIRED') then
    raise exception using errcode = '22023', message = 'appointment no longer accepts auxiliary changes';
  end if;

  select count(*)::integer into v_item_count
  from public.appointment_items
  where organization_id = p_organization_id and appointment_id = p_appointment_id;
  if v_item_count < 1 then
    raise exception using errcode = '22023', message = 'appointment has no service items for auxiliary commissions';
  end if;
  select count(distinct value ->> 'barber_id')::integer into v_unique_count
  from jsonb_array_elements(p_auxiliaries);
  if v_unique_count <> jsonb_array_length(p_auxiliaries) then
    raise exception using errcode = '22023', message = 'duplicate appointment auxiliary';
  end if;

  delete from public.appointment_auxiliaries existing
  where existing.organization_id = p_organization_id
    and existing.appointment_id = p_appointment_id
    and not exists (
      select 1 from jsonb_array_elements(p_auxiliaries) incoming
      where incoming ->> 'barber_id' = existing.assistant_barber_id::text
    );

  for v_aux in select value from jsonb_array_elements(p_auxiliaries)
  loop
    v_barber_id := (v_aux ->> 'barber_id')::uuid;
    if v_barber_id = v_appointment.barber_id then
      raise exception using errcode = '22023', message = 'appointment primary professional cannot be an auxiliary';
    end if;
    if not exists (
      select 1 from public.barbers barber
      where barber.id = v_barber_id and barber.organization_id = p_organization_id and barber.active
    ) then
      raise exception using errcode = '22023', message = 'appointment auxiliary must be an active professional in this organization';
    end if;
    if jsonb_typeof(v_aux -> 'commissions') <> 'array' then
      raise exception using errcode = '22023', message = 'auxiliary commission rules are required';
    end if;
    select count(*)::integer into v_rule_count from jsonb_array_elements(v_aux -> 'commissions');
    select count(distinct value ->> 'appointment_item_id')::integer into v_unique_count
    from jsonb_array_elements(v_aux -> 'commissions');
    if v_rule_count <> v_item_count or v_unique_count <> v_item_count then
      raise exception using errcode = '22023', message = 'each auxiliary needs one commission rule per appointment service';
    end if;

    insert into public.appointment_auxiliaries (organization_id, appointment_id, assistant_barber_id, created_by)
    values (p_organization_id, p_appointment_id, v_barber_id, auth.uid())
    on conflict (organization_id, appointment_id, assistant_barber_id) do nothing;
    get diagnostics v_rule_count = row_count;
    v_new_assignment := v_rule_count = 1;
    select id into strict v_auxiliary_id from public.appointment_auxiliaries
    where organization_id = p_organization_id and appointment_id = p_appointment_id
      and assistant_barber_id = v_barber_id;

    for v_rule in select value from jsonb_array_elements(v_aux -> 'commissions')
    loop
      if not exists (
        select 1 from public.appointment_items item
        where item.id = (v_rule ->> 'appointment_item_id')::uuid
          and item.organization_id = p_organization_id and item.appointment_id = p_appointment_id
      ) then
        raise exception using errcode = '22023', message = 'auxiliary commission service does not belong to appointment';
      end if;
      insert into public.appointment_auxiliary_commission_rules (
        organization_id, auxiliary_id, appointment_item_id, commission_mode, fixed_cents, percentage_bps
      ) values (
        p_organization_id, v_auxiliary_id, (v_rule ->> 'appointment_item_id')::uuid,
        (v_rule ->> 'commission_mode')::public.commission_mode,
        case when v_rule ->> 'commission_mode' = 'FIXED' then (v_rule ->> 'fixed_cents')::bigint end,
        case when v_rule ->> 'commission_mode' = 'PERCENT' then (v_rule ->> 'percentage_bps')::integer end
      ) on conflict (organization_id, auxiliary_id, appointment_item_id) do update
        set commission_mode = excluded.commission_mode,
            fixed_cents = excluded.fixed_cents,
            percentage_bps = excluded.percentage_bps;
    end loop;
    delete from public.appointment_auxiliary_commission_rules rule
    where rule.organization_id = p_organization_id and rule.auxiliary_id = v_auxiliary_id
      and not exists (
        select 1 from jsonb_array_elements(v_aux -> 'commissions') incoming
        where incoming ->> 'appointment_item_id' = rule.appointment_item_id::text
      );
    if v_new_assignment then
      begin
        perform public.enqueue_appointment_auxiliary_staff_message(
          p_organization_id, p_appointment_id, 'BOOKING', v_auxiliary_id, true
        );
      exception when others then
        raise warning 'Auxiliary booking notice could not be queued (SQLSTATE %)', sqlstate;
      end;
    end if;
  end loop;
end;
$$;

create or replace function public.save_appointment_auxiliaries_from_services(
  p_organization_id uuid,
  p_appointment_id uuid,
  p_auxiliaries jsonb
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_result jsonb := '[]'::jsonb;
  v_aux jsonb;
  v_rules jsonb;
  v_item record;
  v_service_rule jsonb;
begin
  for v_aux in select value from jsonb_array_elements(p_auxiliaries)
  loop
    v_rules := '[]'::jsonb;
    for v_item in
      select id, service_id from public.appointment_items
      where organization_id = p_organization_id and appointment_id = p_appointment_id
      order by position, id
    loop
      select value into v_service_rule
      from jsonb_array_elements(v_aux -> 'commissions')
      where value ->> 'service_id' = v_item.service_id::text;
      if v_service_rule is null then
        raise exception using errcode = '22023', message = 'commission rule missing for an appointment service';
      end if;
      v_rules := v_rules || jsonb_build_array(jsonb_build_object(
        'appointment_item_id', v_item.id,
        'commission_mode', v_service_rule ->> 'commission_mode',
        'fixed_cents', v_service_rule -> 'fixed_cents',
        'percentage_bps', v_service_rule -> 'percentage_bps'
      ));
    end loop;
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'barber_id', v_aux ->> 'barber_id', 'commissions', v_rules
    ));
  end loop;
  perform public.save_appointment_auxiliaries(p_organization_id, p_appointment_id, v_result);
end;
$$;

create or replace function public.create_manual_appointment_with_auxiliaries(
  p_organization_id uuid, p_customer_id uuid, p_barber_id uuid, p_starts_at timestamptz,
  p_selections jsonb, p_override_reason text, p_notes text, p_environment_id uuid, p_auxiliaries jsonb
)
returns uuid language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_appointment_id uuid;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization owner required';
  end if;
  v_appointment_id := public.create_manual_appointment(
    p_organization_id, p_customer_id, p_barber_id, p_starts_at, p_selections,
    p_override_reason, p_notes, p_environment_id
  );
  if jsonb_array_length(p_auxiliaries) > 0 then
    perform public.save_appointment_auxiliaries_from_services(p_organization_id, v_appointment_id, p_auxiliaries);
  end if;
  return v_appointment_id;
end;
$$;

create or replace function public.create_project_appointment_with_auxiliaries(
  p_organization_id uuid, p_session_id uuid, p_barber_id uuid, p_service_id uuid,
  p_starts_at timestamptz, p_environment_id uuid, p_override_reason text, p_notes text, p_auxiliaries jsonb
)
returns uuid language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_appointment_id uuid;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization owner required';
  end if;
  v_appointment_id := public.create_project_appointment(
    p_organization_id, p_session_id, p_barber_id, p_service_id,
    p_starts_at, p_environment_id, p_override_reason, p_notes
  );
  if jsonb_array_length(p_auxiliaries) > 0 then
    perform public.save_appointment_auxiliaries_from_services(p_organization_id, v_appointment_id, p_auxiliaries);
  end if;
  return v_appointment_id;
end;
$$;

create or replace function public.enqueue_appointment_auxiliary_staff_message(
  p_organization_id uuid,
  p_appointment_id uuid,
  p_kind text,
  p_auxiliary_id uuid default null,
  p_is_new_assignment boolean default false
)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_appointment public.appointments%rowtype;
  v_connection public.whatsapp_business_connections%rowtype;
  v_settings public.whatsapp_automation_settings_v2%rowtype;
  v_customer public.customers%rowtype;
  v_primary public.barbers%rowtype;
  v_org public.organizations%rowtype;
  v_auxiliary record;
  v_payload jsonb;
  v_service_names text;
  v_when timestamptz;
  v_key text;
begin
  if p_kind not in ('BOOKING', 'CANCEL') then
    raise exception using errcode = '22023', message = 'unsupported auxiliary notification kind';
  end if;
  select * into v_appointment from public.appointments
  where id = p_appointment_id and organization_id = p_organization_id;
  if not found then return; end if;
  select * into v_connection from public.whatsapp_business_connections
  where organization_id = p_organization_id and provider = 'QR_WEB' and is_active and status = 'CONNECTED'
  order by updated_at desc limit 1;
  if not found then return; end if;
  select * into v_settings from public.whatsapp_automation_settings_v2 where organization_id = p_organization_id;
  if not found or v_settings.mode <> 'ACTIVE' or v_settings.dispatch_paused
     or not v_settings.staff_notifications_enabled
     or (p_kind = 'BOOKING' and not v_settings.booking_staff_enabled) then return; end if;
  select * into v_customer from public.customers where id = v_appointment.customer_id and organization_id = p_organization_id;
  select * into v_primary from public.barbers where id = v_appointment.barber_id and organization_id = p_organization_id;
  select * into v_org from public.organizations where id = p_organization_id;
  if v_customer.id is null or v_primary.id is null or v_org.id is null then return; end if;
  select coalesce(nullif(string_agg(item.service_name_snapshot, ', ' order by item.position), ''), 'Serviço não informado')
  into v_service_names from public.appointment_items item
  where item.organization_id = p_organization_id and item.appointment_id = p_appointment_id;
  v_when := lower(v_appointment.service_period);
  v_payload := jsonb_build_object(
    'customer_name', v_customer.full_name, 'barber_name', v_primary.display_name,
    'service_names', v_service_names, 'starts_at', v_when, 'timezone', v_org.timezone,
    'currency', v_appointment.currency, 'total_cents', v_appointment.total_cents_snapshot,
    'templates', public.whatsapp_v2_default_message_templates() || v_settings.templates
  );
  for v_auxiliary in
    select assignment.id, assignment.assistant_barber_id, barber.whatsapp_e164
    from public.appointment_auxiliaries assignment
    join public.barbers barber on barber.id = assignment.assistant_barber_id
      and barber.organization_id = assignment.organization_id
    where assignment.organization_id = p_organization_id and assignment.appointment_id = p_appointment_id
      and (p_auxiliary_id is null or assignment.id = p_auxiliary_id)
      and barber.whatsapp_e164 is not null
  loop
    if p_kind = 'BOOKING' then
      v_key := 'v2:' || p_appointment_id || ':assistant:' || v_auxiliary.id || ':'
        || case when p_is_new_assignment then 'assigned' else 'v' || v_appointment.version end;
      insert into public.whatsapp_automation_jobs (
        organization_id, connection_id, appointment_id, appointment_version, job_type,
        recipient_e164, payload, valid_until, dedupe_key
      ) values (
        p_organization_id, v_connection.id, p_appointment_id, v_appointment.version,
        'BOOKING_CREATED_STAFF', v_auxiliary.whatsapp_e164, v_payload, v_when, v_key
      ) on conflict (organization_id, dedupe_key) do nothing;
    else
      v_key := 'v2:' || p_appointment_id || ':v' || v_appointment.version || ':cancellation:assistant:' || v_auxiliary.id;
      insert into public.whatsapp_automation_jobs (
        organization_id, connection_id, appointment_id, appointment_version,
        customer_id, priority, job_type, recipient_e164, payload, scheduled_for,
        next_attempt_at, valid_until, status, dedupe_key
      ) values (
        p_organization_id, v_connection.id, p_appointment_id, v_appointment.version,
        v_appointment.customer_id, 0, 'APPOINTMENT_CANCELED_STAFF', v_auxiliary.whatsapp_e164,
        v_payload, now(), now(), now() + interval '24 hours', 'PENDING', v_key
      ) on conflict (organization_id, dedupe_key) do nothing;
    end if;
  end loop;
end;
$$;

create or replace function public.enqueue_appointment_auxiliary_booking_trigger()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_should_notify boolean := false;
begin
  if new.status = 'CONFIRMED' then
    if tg_op = 'INSERT' then
      v_should_notify := true;
    elsif old.status is distinct from new.status
       or old.service_period is distinct from new.service_period
       or old.version is distinct from new.version then
      v_should_notify := true;
    end if;
  end if;
  if v_should_notify then
    begin
      perform public.enqueue_appointment_auxiliary_staff_message(new.organization_id, new.id, 'BOOKING', null, false);
    exception when others then
      raise warning 'Auxiliary booking notice could not be queued (SQLSTATE %)', sqlstate;
    end;
  end if;
  return new;
end;
$$;
create trigger appointments_enqueue_auxiliary_booking_whatsapp
  after insert or update of status, service_period, version on public.appointments
  for each row execute function public.enqueue_appointment_auxiliary_booking_trigger();

create or replace function public.enqueue_appointment_auxiliary_cancellation_trigger()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- WhatsApp-originated cancellation does not enqueue the primary staff notice in
  -- the legacy flow; assistants still need the same operational update.
  if new.status = 'CANCELED' and new.cancellation_source = 'WHATSAPP_CLIENT'
     and (old.status is distinct from new.status or old.cancellation_source is distinct from new.cancellation_source) then
    begin
      perform public.enqueue_appointment_auxiliary_staff_message(new.organization_id, new.id, 'CANCEL', null, false);
    exception when others then
      raise warning 'Auxiliary cancellation notice could not be queued (SQLSTATE %)', sqlstate;
    end;
  end if;
  return new;
end;
$$;
create trigger appointments_enqueue_auxiliary_cancellation_whatsapp
  after update of status, cancellation_source on public.appointments
  for each row execute function public.enqueue_appointment_auxiliary_cancellation_trigger();

create or replace function public.award_appointment_auxiliary_commissions()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_rule record;
  v_amount bigint;
begin
  if new.status <> 'COMPLETED' or old.status = 'COMPLETED' then return new; end if;
  for v_rule in
    select assignment.id auxiliary_id, assignment.assistant_barber_id, rule.appointment_item_id,
      rule.commission_mode, rule.fixed_cents, rule.percentage_bps, item.quantity,
      item.list_price_cents_snapshot
    from public.appointment_auxiliaries assignment
    join public.appointment_auxiliary_commission_rules rule
      on rule.organization_id = assignment.organization_id and rule.auxiliary_id = assignment.id
    join public.appointment_items item
      on item.organization_id = rule.organization_id and item.id = rule.appointment_item_id
    where assignment.organization_id = new.organization_id and assignment.appointment_id = new.id
    order by assignment.assistant_barber_id, item.position
  loop
    v_amount := case v_rule.commission_mode
      when 'FIXED' then v_rule.fixed_cents * v_rule.quantity
      when 'PERCENT' then round(v_rule.list_price_cents_snapshot::numeric * v_rule.quantity * v_rule.percentage_bps / 10000)::bigint
      else 0
    end;
    if v_amount > 0 then
      insert into public.commission_ledger (
        organization_id, barber_id, appointment_id, appointment_item_id,
        kind, amount_cents, idempotency_key, earned_at, created_by
      ) values (
        new.organization_id, v_rule.assistant_barber_id, new.id, v_rule.appointment_item_id,
        'EARNED', v_amount, 'assistant-earned:' || v_rule.auxiliary_id || ':' || v_rule.appointment_item_id,
        now(), auth.uid()
      ) on conflict (organization_id, idempotency_key) do nothing;
    end if;
  end loop;
  return new;
end;
$$;
create trigger appointments_award_auxiliary_commissions
  after update of status on public.appointments
  for each row execute function public.award_appointment_auxiliary_commissions();

create or replace function public.clone_appointment_staff_whatsapp_to_auxiliaries()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.appointment_id is null or not (
    new.job_type in ('APPOINTMENT_CONFIRMED_STAFF', 'APPOINTMENT_CANCELED_STAFF')
    or (new.job_type = 'MANUAL_OUTBOUND_TEXT' and new.payload ->> 'message_kind' = 'MANUAL_CONFIRMATION_STAFF')
  ) then return new; end if;
  begin
    insert into public.whatsapp_automation_jobs (
      organization_id, connection_id, appointment_id, appointment_version,
      confirmation_request_id, job_type, recipient_e164, payload, scheduled_for,
      next_attempt_at, valid_until, status, priority, dedupe_key
    )
    select new.organization_id, new.connection_id, new.appointment_id, new.appointment_version,
      new.confirmation_request_id, new.job_type, barber.whatsapp_e164, new.payload,
      new.scheduled_for, new.next_attempt_at, new.valid_until, 'PENDING', new.priority,
      new.dedupe_key || ':assistant:' || assignment.id
    from public.appointment_auxiliaries assignment
    join public.barbers barber on barber.id = assignment.assistant_barber_id
      and barber.organization_id = assignment.organization_id
    where assignment.organization_id = new.organization_id and assignment.appointment_id = new.appointment_id
      and barber.whatsapp_e164 is not null and barber.whatsapp_e164 ~ '^\+[1-9][0-9]{7,14}$'
      and barber.whatsapp_e164 <> new.recipient_e164
    on conflict (organization_id, dedupe_key) do nothing;
  exception when others then
    raise warning 'Auxiliary WhatsApp job copy skipped (SQLSTATE %)', sqlstate;
  end;
  return new;
end;
$$;
create trigger whatsapp_jobs_clone_staff_notice_to_auxiliaries
  after insert on public.whatsapp_automation_jobs
  for each row execute function public.clone_appointment_staff_whatsapp_to_auxiliaries();

revoke all on function public.save_appointment_auxiliaries(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_appointment_auxiliaries(uuid, uuid, jsonb) to authenticated;
revoke all on function public.save_appointment_auxiliaries_from_services(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.create_manual_appointment_with_auxiliaries(uuid, uuid, uuid, timestamptz, jsonb, text, text, uuid, jsonb) from public, anon;
grant execute on function public.create_manual_appointment_with_auxiliaries(uuid, uuid, uuid, timestamptz, jsonb, text, text, uuid, jsonb) to authenticated;
revoke all on function public.create_project_appointment_with_auxiliaries(uuid, uuid, uuid, uuid, timestamptz, uuid, text, text, jsonb) from public, anon;
grant execute on function public.create_project_appointment_with_auxiliaries(uuid, uuid, uuid, uuid, timestamptz, uuid, text, text, jsonb) to authenticated;
revoke all on function public.enqueue_appointment_auxiliary_staff_message(uuid, uuid, text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.enqueue_appointment_auxiliary_booking_trigger() from public, anon, authenticated;
revoke all on function public.enqueue_appointment_auxiliary_cancellation_trigger() from public, anon, authenticated;
revoke all on function public.award_appointment_auxiliary_commissions() from public, anon, authenticated;
revoke all on function public.clone_appointment_staff_whatsapp_to_auxiliaries() from public, anon, authenticated;
