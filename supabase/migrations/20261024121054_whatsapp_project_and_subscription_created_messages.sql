-- Editable, transactional notices for manager-created project contracts and subscriptions.
-- The payload stores only the masked email; all writes remain tenant-scoped and deduplicated.

alter function public.whatsapp_v2_default_message_templates()
  rename to whatsapp_v2_default_message_templates_before_contract_notices;
create function public.whatsapp_v2_default_message_templates()
returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select public.whatsapp_v2_default_message_templates_before_contract_notices() || jsonb_build_object(
    'PROJECT_CONTRACT_CREATED_CLIENT', 'Olá! {cliente}, passando para informar que foi criado um novo plano de serviços para você. Para mais detalhes e aceite do plano, acesse o app do cliente na aba Assinaturas: {link_app_cliente}. Você deve fazer login no app com o e-mail {email_cliente}.',
    'SUBSCRIPTION_CREATED_CLIENT', 'Olá! {cliente}, passando para informar que foi criada uma nova assinatura para você. Para mais detalhes e aceite desta assinatura, acesse o app do cliente na aba Assinaturas: {link_app_cliente}. Você deve fazer login no app com o e-mail {email_cliente}.'
  );
$$;
revoke all on function public.whatsapp_v2_default_message_templates_before_contract_notices() from public, anon, authenticated;
grant execute on function public.whatsapp_v2_default_message_templates_before_contract_notices() to service_role;
revoke all on function public.whatsapp_v2_default_message_templates() from public, anon, authenticated;
grant execute on function public.whatsapp_v2_default_message_templates() to service_role;

alter function public.whatsapp_v2_legacy_default_message_templates()
  rename to whatsapp_v2_legacy_default_message_templates_before_contract_notices;
create function public.whatsapp_v2_legacy_default_message_templates()
returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select public.whatsapp_v2_legacy_default_message_templates_before_contract_notices() || jsonb_build_object(
    'PROJECT_CONTRACT_CREATED_CLIENT', 'Olá! {cliente}, passando para informar que foi criado um novo plano de serviços para você. Para mais detalhes e aceite do plano, acesse o app do cliente na aba Assinaturas: {link_app_cliente}. Você deve fazer login no app com o e-mail {email_cliente}.',
    'SUBSCRIPTION_CREATED_CLIENT', 'Olá! {cliente}, passando para informar que foi criada uma nova assinatura para você. Para mais detalhes e aceite desta assinatura, acesse o app do cliente na aba Assinaturas: {link_app_cliente}. Você deve fazer login no app com o e-mail {email_cliente}.'
  );
$$;
revoke all on function public.whatsapp_v2_legacy_default_message_templates_before_contract_notices() from public, anon, authenticated;
grant execute on function public.whatsapp_v2_legacy_default_message_templates_before_contract_notices() to service_role;
revoke all on function public.whatsapp_v2_legacy_default_message_templates() from public, anon, authenticated;
grant execute on function public.whatsapp_v2_legacy_default_message_templates() to service_role;

-- Keep the product localization trigger, and seed missing defaults without replacing custom copy.
update public.whatsapp_automation_settings_v2 s
set templates = public.whatsapp_v2_default_message_templates() || coalesce(s.templates, '{}'::jsonb)
where not (coalesce(s.templates, '{}'::jsonb) ? 'PROJECT_CONTRACT_CREATED_CLIENT')
   or not (coalesce(s.templates, '{}'::jsonb) ? 'SUBSCRIPTION_CREATED_CLIENT');

create or replace function public.save_whatsapp_v2_automation_controls(
  p_organization_id uuid,
  p_rules jsonb,
  p_custom_messages jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_booking_client boolean;
  v_booking_staff boolean;
  v_t24 boolean;
  v_morning boolean;
  v_t180 boolean;
  v_t45 boolean;
  v_existing_templates jsonb;
  v_input_templates jsonb;
  v_templates jsonb;
  v_reminder_count integer;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'not organization owner';
  end if;
  if jsonb_typeof(p_rules) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid automation rules';
  end if;
  if jsonb_typeof(p_custom_messages) <> 'array' then
    raise exception using errcode = '22023', message = 'invalid custom messages';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_custom_messages) item
    where jsonb_typeof(item) <> 'object'
      or item ->> 'key' not in ('AFTER_SERVICE_14D', 'AFTER_SERVICE_28D', 'AFTER_SERVICE_40D', 'BIRTHDAY', 'SPECIAL_DATES', 'MARKETING_CAMPAIGNS')
      or jsonb_typeof(item -> 'enabled') <> 'boolean'
      or jsonb_typeof(item -> 'body') <> 'string'
      or char_length(item ->> 'body') > 4096
  ) then
    raise exception using errcode = '22023', message = 'invalid custom message definition';
  end if;
  if (select count(*) from jsonb_array_elements(p_custom_messages)) <> (
    select count(distinct item ->> 'key') from jsonb_array_elements(p_custom_messages) item
  ) then
    raise exception using errcode = '22023', message = 'duplicate custom message definition';
  end if;

  v_input_templates := coalesce(p_rules -> 'message_templates', '{}'::jsonb);
  if jsonb_typeof(v_input_templates) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid message templates';
  end if;
  if exists (
    select 1 from jsonb_each(v_input_templates) entry
    where entry.key not in (
      'BOOKING_CREATED_CLIENT', 'BOOKING_CREATED_STAFF', 'REMINDER_T24_CLIENT',
      'REMINDER_MORNING_CLIENT', 'REMINDER_T180_CLIENT', 'REMINDER_T45_CLIENT',
      'CONFIRMATION_ACK_CLIENT', 'CANCELLATION_ACK_CLIENT',
      'APPOINTMENT_CONFIRMED_STAFF', 'APPOINTMENT_CANCELED_STAFF',
      'INVALID_REPLY_PROMPT', 'ATTENDANT_REQUEST_MANAGER',
      'MANUAL_CONFIRMATION_CLIENT', 'MANUAL_CONFIRMATION_STAFF', 'RESERVATION_CHOICE',
      'PROJECT_CONTRACT_CREATED_CLIENT', 'SUBSCRIPTION_CREATED_CLIENT'
    ) or jsonb_typeof(entry.value) <> 'string'
      or char_length(btrim(entry.value #>> '{}')) = 0
      or char_length(entry.value #>> '{}') > 4096
  ) then
    raise exception using errcode = '22023', message = 'invalid message templates';
  end if;

  v_booking_client := coalesce((p_rules ->> 'booking_client_enabled')::boolean, true);
  v_booking_staff := coalesce((p_rules ->> 'booking_staff_enabled')::boolean, true);
  v_t24 := coalesce((p_rules ->> 'reminder_t24_enabled')::boolean, false);
  v_morning := coalesce((p_rules ->> 'reminder_morning_enabled')::boolean, false);
  v_t180 := coalesce((p_rules ->> 'reminder_t180_enabled')::boolean, false);
  v_t45 := coalesce((p_rules ->> 'reminder_t45_enabled')::boolean, true);
  v_reminder_count := (case when v_t24 then 1 else 0 end) + (case when v_morning then 1 else 0 end)
    + (case when v_t180 then 1 else 0 end) + (case when v_t45 then 1 else 0 end);
  if v_reminder_count > 1 then
    raise exception using errcode = '22023', message = 'only one presence reminder may be active';
  end if;

  select templates into v_existing_templates from public.whatsapp_automation_settings_v2
  where organization_id = p_organization_id for update;
  v_templates := public.whatsapp_v2_default_message_templates()
    || coalesce(v_existing_templates, '{}'::jsonb) || v_input_templates;

  insert into public.whatsapp_automation_settings_v2 (
    organization_id, booking_client_enabled, booking_staff_enabled,
    reminder_t24_enabled, reminder_morning_enabled, reminder_t180_enabled,
    reminder_t45_enabled, templates
  ) values (
    p_organization_id, v_booking_client, v_booking_staff, v_t24, v_morning, v_t180, v_t45, v_templates
  ) on conflict (organization_id) do update set
    booking_client_enabled = excluded.booking_client_enabled,
    booking_staff_enabled = excluded.booking_staff_enabled,
    reminder_t24_enabled = excluded.reminder_t24_enabled,
    reminder_morning_enabled = excluded.reminder_morning_enabled,
    reminder_t180_enabled = excluded.reminder_t180_enabled,
    reminder_t45_enabled = excluded.reminder_t45_enabled,
    templates = excluded.templates,
    updated_at = now();

  insert into public.whatsapp_custom_message_settings_v2 (organization_id, message_key, enabled, body)
  select p_organization_id, item ->> 'key', (item ->> 'enabled')::boolean, item ->> 'body'
  from jsonb_array_elements(p_custom_messages) item
  on conflict (organization_id, message_key) do update set enabled = excluded.enabled, body = excluded.body, updated_at = now();

  update public.whatsapp_automation_jobs set status = 'CANCELED', last_error_code = 'AUTOMATION_DISABLED',
    last_error_detail = 'Canceled because its automation was disabled before dispatch.', updated_at = now()
  where organization_id = p_organization_id and status in ('PENDING', 'RETRY') and (
    (job_type = 'BOOKING_CREATED_CLIENT' and not v_booking_client)
    or (job_type = 'BOOKING_CREATED_STAFF' and not v_booking_staff)
    or (job_type = 'REMINDER_T24_CLIENT' and not v_t24)
    or (job_type = 'REMINDER_MORNING_CLIENT' and not v_morning)
    or (job_type = 'REMINDER_T180_CLIENT' and not v_t180)
    or (job_type = 'REMINDER_T45_CLIENT' and not v_t45)
  );

  update public.whatsapp_automation_jobs
  set payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object('templates', v_templates), updated_at = now()
  where organization_id = p_organization_id and status in ('PENDING', 'RETRY');

  return jsonb_build_object(
    'rules', jsonb_build_object(
      'booking_client_enabled', v_booking_client, 'booking_staff_enabled', v_booking_staff,
      'reminder_t24_enabled', v_t24, 'reminder_morning_enabled', v_morning,
      'reminder_t180_enabled', v_t180, 'reminder_t45_enabled', v_t45,
      'message_templates', v_templates
    ),
    'custom_messages', coalesce((select jsonb_agg(jsonb_build_object('key', message_key, 'enabled', enabled, 'body', body) order by message_key)
      from public.whatsapp_custom_message_settings_v2 where organization_id = p_organization_id), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.save_whatsapp_v2_automation_controls(uuid, jsonb, jsonb) from public, anon, service_role;
grant execute on function public.save_whatsapp_v2_automation_controls(uuid, jsonb, jsonb) to authenticated;

create or replace function public.whatsapp_enqueue_manager_plan_created_notice(
  p_organization_id uuid,
  p_customer_id uuid,
  p_reference_id uuid,
  p_message_kind text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_customer public.customers%rowtype;
  v_settings public.whatsapp_automation_settings_v2%rowtype;
  v_connection public.whatsapp_business_connections%rowtype;
  v_templates jsonb;
  v_masked_email text;
begin
  if p_message_kind not in ('PROJECT_CONTRACT_CREATED_CLIENT', 'SUBSCRIPTION_CREATED_CLIENT') then
    raise exception using errcode = '22023', message = 'invalid plan notice kind';
  end if;
  select * into v_customer from public.customers
    where id = p_customer_id and organization_id = p_organization_id and active;
  if not found or v_customer.phone_e164 is null or not public.whatsapp_v2_consented(p_organization_id, p_customer_id) then return; end if;
  select * into v_settings from public.whatsapp_automation_settings_v2
    where organization_id = p_organization_id and runtime_engine = 'ACTIVE' and mode = 'ACTIVE' and not dispatch_paused;
  if not found then return; end if;
  select * into v_connection from public.whatsapp_business_connections
    where organization_id = p_organization_id and is_active and status = 'CONNECTED' order by connected_at desc nulls last limit 1;
  if not found then return; end if;
  v_templates := public.whatsapp_v2_default_message_templates() || coalesce(v_settings.templates, '{}'::jsonb);
  v_masked_email := case
    when v_customer.email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
      then left(split_part(v_customer.email, '@', 1), 3) || '*****@' || split_part(v_customer.email, '@', 2)
    else 'não cadastrado'
  end;

  insert into public.whatsapp_automation_jobs (
    organization_id, connection_id, customer_id, priority, job_type, recipient_e164,
    payload, valid_until, dedupe_key
  ) values (
    p_organization_id, v_connection.id, p_customer_id, 20, 'MANUAL_OUTBOUND_TEXT', v_customer.phone_e164,
    jsonb_build_object(
      'schema_version', 1,
      'message_kind', p_message_kind,
      'transactional_plan_notice', true,
      'customer_name', v_customer.full_name,
      'customer_email_masked', v_masked_email,
      'customer_app_url', 'https://displaysh-app.vercel.app/cliente/assinaturas',
      'templates', v_templates
    ),
    now() + interval '30 days',
    'manager-plan-created:' || p_message_kind || ':' || p_reference_id::text
  ) on conflict (organization_id, dedupe_key) do nothing;
end;
$$;
revoke all on function public.whatsapp_enqueue_manager_plan_created_notice(uuid, uuid, uuid, text) from public, anon, authenticated, service_role;

create or replace function public.notify_project_contract_created_whatsapp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.created_by = auth.uid() and public.is_organization_owner(new.organization_id) then
    perform public.whatsapp_enqueue_manager_plan_created_notice(
      new.organization_id, new.customer_id, new.id, 'PROJECT_CONTRACT_CREATED_CLIENT'
    );
  end if;
  return new;
end;
$$;
revoke all on function public.notify_project_contract_created_whatsapp() from public, anon, authenticated;
drop trigger if exists project_contract_created_whatsapp on public.project_engagements;
create trigger project_contract_created_whatsapp
after insert on public.project_engagements
for each row execute function public.notify_project_contract_created_whatsapp();

create or replace function public.notify_subscription_created_whatsapp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.created_by = auth.uid() and public.is_organization_owner(new.organization_id) then
    perform public.whatsapp_enqueue_manager_plan_created_notice(
      new.organization_id, new.customer_id, new.id, 'SUBSCRIPTION_CREATED_CLIENT'
    );
  end if;
  return new;
end;
$$;
revoke all on function public.notify_subscription_created_whatsapp() from public, anon, authenticated;
drop trigger if exists subscription_created_whatsapp on public.customer_subscriptions;
create trigger subscription_created_whatsapp
after insert on public.customer_subscriptions
for each row execute function public.notify_subscription_created_whatsapp();

-- Revalidate current customer consent, active state and destination immediately before sending.
create or replace function public.whatsapp_runtime_prepare(p_job_id uuid, p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  j public.whatsapp_automation_jobs%rowtype;
  a public.appointments%rowtype;
  c public.customers%rowtype;
  tz text;
  reason text;
  setting public.whatsapp_custom_message_settings_v2%rowtype;
begin
  perform public.require_service_role();
  select * into j from public.whatsapp_automation_jobs where id = p_job_id for update;
  if j.id is null or j.status <> 'PROCESSING' or j.lease_token is distinct from p_token or j.lock_expires_at <= now() then
    raise exception 'STALE_LEASE';
  end if;
  if j.valid_until <= now() or (j.job_type::text like 'REMINDER_%' and j.scheduled_for + interval '5 minutes' <= now()) then
    reason := 'DELIVERY_WINDOW_EXPIRED';
  end if;
  if not exists (
    select 1 from public.whatsapp_automation_settings_v2 s
    join public.whatsapp_business_connections w on w.organization_id = s.organization_id
    where s.organization_id = j.organization_id and s.runtime_engine = 'ACTIVE' and s.mode = 'ACTIVE'
      and not s.dispatch_paused and w.id = j.connection_id and w.is_active and w.status = 'CONNECTED'
  ) then reason := 'CONNECTION_OR_AUTOMATION_PAUSED'; end if;
  if exists (
    select 1 from public.whatsapp_automation_settings_v2 s
    where s.organization_id = j.organization_id and not case j.job_type::text
      when 'BOOKING_CREATED_CLIENT' then s.booking_client_enabled
      when 'BOOKING_CREATED_STAFF' then s.booking_staff_enabled and s.staff_notifications_enabled
      when 'REMINDER_T24_CLIENT' then s.reminder_t24_enabled
      when 'REMINDER_MORNING_CLIENT' then s.reminder_morning_enabled
      when 'REMINDER_T180_CLIENT' then s.reminder_t180_enabled
      when 'REMINDER_T45_CLIENT' then s.reminder_t45_enabled
      when 'APPOINTMENT_CONFIRMED_STAFF' then s.staff_notifications_enabled
      when 'APPOINTMENT_CANCELED_STAFF' then s.staff_notifications_enabled
      else true end
  ) then reason := 'AUTOMATION_DISABLED'; end if;

  if coalesce((j.payload ->> 'transactional_plan_notice')::boolean, false) then
    select * into c from public.customers where id = j.customer_id and organization_id = j.organization_id for share;
    if c.id is null or not c.active or not public.whatsapp_v2_consented(j.organization_id, j.customer_id) then
      reason := 'TRANSACTIONAL_REVOKED';
    elsif c.phone_e164 is distinct from j.recipient_e164 then
      reason := 'RECIPIENT_CHANGED';
    end if;
  end if;

  if j.appointment_id is not null then
    select * into a from public.appointments where id = j.appointment_id and organization_id = j.organization_id;
    if j.job_type::text like 'REMINDER_%' then
      if a.id is null or a.version is distinct from j.appointment_version or a.status in ('CANCELED', 'COMPLETED', 'EXPIRED', 'IN_SERVICE', 'NO_SHOW') or lower(a.service_period) <= now() then
        reason := 'APPOINTMENT_CHANGED';
      end if;
    elsif j.job_type::text like 'BOOKING_CREATED_%' then
      if a.id is null or a.version is distinct from j.appointment_version or a.status <> 'CONFIRMED' or lower(a.service_period) <= now() then
        reason := 'APPOINTMENT_CHANGED';
      end if;
    end if;
    if j.job_type::text like '%_CLIENT' or j.payload ->> 'message_kind' = 'MANUAL_CONFIRMATION_CLIENT' then
      if a.id is null or not public.whatsapp_v2_consented(j.organization_id, a.customer_id) then reason := 'TRANSACTIONAL_REVOKED'; end if;
      select * into c from public.customers where id = a.customer_id and organization_id = j.organization_id;
      if c.phone_e164 is distinct from j.recipient_e164 then reason := 'RECIPIENT_CHANGED'; end if;
    end if;
  end if;
  if j.dedupe_key like 'campaign:%' and exists (
    select 1 from public.whatsapp_campaigns ca where ca.id::text = split_part(j.dedupe_key, ':', 2)
      and ca.organization_id = j.organization_id and ca.status = 'CANCELED'
  ) then reason := 'CAMPAIGN_CANCELED'; end if;
  if j.custom_key is not null then
    select * into c from public.customers where id = j.customer_id and organization_id = j.organization_id for update;
    select timezone into tz from public.organizations where id = j.organization_id;
    select * into setting from public.whatsapp_custom_message_settings_v2 where organization_id = j.organization_id and message_key = j.custom_key;
    if not coalesce(setting.enabled, false) then reason := 'AUTOMATION_DISABLED'; end if;
    if not public.whatsapp_marketing_allowed(j.organization_id, j.customer_id) then reason := 'MARKETING_REVOKED'; end if;
    if c.id is null or not c.active or c.phone_e164 is distinct from j.recipient_e164 then reason := 'RECIPIENT_CHANGED'; end if;
    if exists (
      select 1 from public.whatsapp_automation_jobs x
      where x.organization_id = j.organization_id and x.customer_id = j.customer_id and x.id <> j.id
        and x.custom_key is not null and x.send_started_at is not null
        and x.status in ('PROCESSING', 'SUBMITTED', 'DELIVERED', 'READ', 'SEND_UNKNOWN')
        and (x.send_started_at at time zone tz)::date = (now() at time zone tz)::date
    ) or (
      select count(*) from public.whatsapp_automation_jobs x
      where x.organization_id = j.organization_id and x.customer_id = j.customer_id and x.id <> j.id
        and x.custom_key is not null and x.send_started_at is not null
        and x.status in ('PROCESSING', 'SUBMITTED', 'DELIVERED', 'READ', 'SEND_UNKNOWN')
        and x.send_started_at >= date_trunc('week', now() at time zone tz) at time zone tz
    ) >= 2 then reason := 'FREQUENCY_LIMIT'; end if;
    if j.custom_key like 'AFTER_SERVICE_%' and exists (
      select 1 from public.appointments x where x.organization_id = j.organization_id and x.customer_id = j.customer_id
        and ((x.status = 'CONFIRMED' and lower(x.service_period) > now()) or
          (x.status = 'COMPLETED' and coalesce((select max(se.created_at) from public.appointment_status_events se
            where se.organization_id = x.organization_id and se.appointment_id = x.id and se.to_status = 'COMPLETED'), upper(x.service_period)) > (j.payload ->> 'completed_at')::timestamptz))
    ) then reason := 'CUSTOMER_RETURNED_OR_BOOKED'; end if;
  end if;
  if reason is not null then
    update public.whatsapp_automation_jobs set status = 'SKIPPED', last_error_code = reason,
      locked_by = null, lease_token = null, lock_expires_at = null, updated_at = now() where id = j.id;
    return jsonb_build_object('ready', false, 'reason', reason);
  end if;
  if j.job_type::text like 'REMINDER_%' then perform public.create_whatsapp_v2_confirmation_request(j.id, j.locked_by); end if;
  return jsonb_build_object('ready', true);
end;
$$;
revoke all on function public.whatsapp_runtime_prepare(uuid, uuid) from public, anon, authenticated;
grant execute on function public.whatsapp_runtime_prepare(uuid, uuid) to service_role;
