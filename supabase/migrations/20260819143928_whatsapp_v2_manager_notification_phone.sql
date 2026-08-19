-- A separate recipient makes the attendant handoff observable. Sending a
-- message from the QR-connected account to itself is accepted by Evolution,
-- but WhatsApp does not reliably surface it as a new-manager notification.
alter table public.whatsapp_automation_settings_v2
  add column if not exists manager_notification_phone_e164 text
  check (manager_notification_phone_e164 is null or manager_notification_phone_e164 ~ '^\\+[1-9][0-9]{7,14}$');

create or replace function public.get_whatsapp_connection_status(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'not organization owner';
  end if;

  return jsonb_build_object(
    'connections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'provider', c.provider,
        'status', c.status,
        'is_active', c.is_active,
        'waba_id', c.waba_id,
        'phone_number_id', c.phone_number_id,
        'gateway_instance_id', c.gateway_instance_id,
        'connected_at', c.connected_at,
        'disconnected_at', c.disconnected_at,
        'last_error_code', c.last_error_code,
        'last_status_at', c.last_status_at,
        'connection_epoch_at', c.connection_epoch_at,
        'health_status', c.health_status,
        'health_checked_at', c.health_checked_at,
        'health_error_code', c.health_error_code,
        'health_consecutive_failures', c.health_consecutive_failures,
        'qr_code', case when c.qr_expires_at > now() then c.qr_code else null end,
        'qr_expires_at', case when c.qr_expires_at > now() then c.qr_expires_at else null end
      ) order by c.provider)
      from public.whatsapp_business_connections c
      where c.organization_id = p_organization_id
    ), '[]'::jsonb),
    'reminders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'position', r.position,
        'enabled', r.enabled,
        'offset_minutes', r.offset_minutes,
        'template_key', r.template_key,
        'language_code', r.language_code
      ) order by r.position)
      from public.whatsapp_reminder_rules r
      where r.organization_id = p_organization_id
    ), '[]'::jsonb),
    'automation', coalesce((
      select jsonb_build_object(
        'confirmation_enabled', a.confirmation_enabled,
        'confirmation_template_key', a.confirmation_template_key,
        'welcome_enabled', a.welcome_enabled,
        'welcome_message', a.welcome_message
      ) from public.whatsapp_automation_settings a
      where a.organization_id = p_organization_id
    ), jsonb_build_object(
      'confirmation_enabled', true,
      'confirmation_template_key', 'appointment_confirmation',
      'welcome_enabled', true,
      'welcome_message', ''
    )),
    'manager_notification', coalesce((
      select jsonb_build_object(
        'phone_e164', s.manager_notification_phone_e164,
        'matches_qr_phone', s.manager_notification_phone_e164 is not null and exists (
          select 1 from public.whatsapp_business_connections c
          where c.organization_id = s.organization_id
            and c.provider = 'QR_WEB'
            and c.is_active
            and c.connected_phone_e164 is not null
            and public.whatsapp_v2_phone_matches(c.connected_phone_e164, s.manager_notification_phone_e164)
        )
      )
      from public.whatsapp_automation_settings_v2 s
      where s.organization_id = p_organization_id
    ), jsonb_build_object('phone_e164', null, 'matches_qr_phone', false))
  );
end;
$$;

create or replace function public.save_whatsapp_v2_manager_notification_phone(
  p_organization_id uuid,
  p_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_input text := btrim(coalesce(p_phone, ''));
  v_digits text;
  v_phone text;
  v_matches_qr boolean;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'not organization owner';
  end if;

  if v_input = '' then
    v_phone := null;
  else
    v_digits := regexp_replace(v_input, '\\D', '', 'g');
    if char_length(v_digits) < 8 or char_length(v_digits) > 15 then
      raise exception using errcode = '22023', message = 'invalid manager notification phone';
    end if;
    if left(v_input, 1) = '+' or (left(v_digits, 2) = '55' and char_length(v_digits) >= 12) then
      v_phone := '+' || v_digits;
    else
      v_phone := '+55' || v_digits;
    end if;
    if v_phone !~ '^\\+[1-9][0-9]{7,14}$' then
      raise exception using errcode = '22023', message = 'invalid manager notification phone';
    end if;
  end if;

  insert into public.whatsapp_automation_settings_v2 (organization_id, manager_notification_phone_e164)
  values (p_organization_id, v_phone)
  on conflict (organization_id) do update
    set manager_notification_phone_e164 = excluded.manager_notification_phone_e164,
        updated_at = now();

  select v_phone is not null and exists (
    select 1 from public.whatsapp_business_connections c
    where c.organization_id = p_organization_id
      and c.provider = 'QR_WEB'
      and c.is_active
      and c.connected_phone_e164 is not null
      and public.whatsapp_v2_phone_matches(c.connected_phone_e164, v_phone)
  ) into v_matches_qr;

  return jsonb_build_object('phone_e164', v_phone, 'matches_qr_phone', coalesce(v_matches_qr, false));
end;
$$;

revoke all on function public.save_whatsapp_v2_manager_notification_phone(uuid, text) from public, anon;
grant execute on function public.save_whatsapp_v2_manager_notification_phone(uuid, text) to authenticated;

create or replace function public.process_whatsapp_v2_text_response(
  p_gateway_instance_id text,
  p_sender_e164 text,
  p_external_message_id text,
  p_action text
)
returns jsonb language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_connection public.whatsapp_business_connections%rowtype;
  v_request public.whatsapp_confirmation_requests_v2%rowtype;
  v_appointment public.appointments%rowtype;
  v_active_request_count integer;
  v_invalid_count smallint;
  v_action text := upper(btrim(p_action));
  v_service_names text;
  v_manager_phone text;
begin
  perform public.require_service_role();
  select * into v_connection from public.whatsapp_business_connections
  where provider='QR_WEB' and gateway_instance_id=p_gateway_instance_id and is_active and status='CONNECTED'
  for update;
  if not found then return jsonb_build_object('processed',false,'reason','UNKNOWN_CONNECTION'); end if;

  select count(*) into v_active_request_count
  from public.whatsapp_confirmation_requests_v2 r
  join public.appointments a on a.id=r.appointment_id and a.organization_id=r.organization_id
  join public.customers c on c.id=a.customer_id and c.organization_id=a.organization_id
  where r.connection_id=v_connection.id and r.status='PENDING' and r.expires_at>now()
    and a.version=r.appointment_version and a.status='CONFIRMED'
    and public.whatsapp_v2_phone_matches(c.phone_e164,p_sender_e164);
  if v_active_request_count=0 then return jsonb_build_object('processed',false,'reason','NO_ACTIVE_REQUEST'); end if;
  if v_active_request_count>1 then return jsonb_build_object('processed',false,'reason','AMBIGUOUS_ACTIVE_REQUEST'); end if;

  select r.* into v_request
  from public.whatsapp_confirmation_requests_v2 r
  join public.appointments a on a.id=r.appointment_id and a.organization_id=r.organization_id
  join public.customers c on c.id=a.customer_id and c.organization_id=a.organization_id
  where r.connection_id=v_connection.id and r.status='PENDING' and r.expires_at>now()
    and a.version=r.appointment_version and a.status='CONFIRMED'
    and public.whatsapp_v2_phone_matches(c.phone_e164,p_sender_e164)
  for update of r;
  select * into v_appointment from public.appointments
  where id=v_request.appointment_id and organization_id=v_request.organization_id for update;

  if v_action='INVALID' then
    update public.whatsapp_confirmation_requests_v2
    set invalid_reply_count=invalid_reply_count+1,updated_at=now()
    where id=v_request.id returning invalid_reply_count into v_invalid_count;
    if v_invalid_count<=2 then
      insert into public.whatsapp_automation_jobs (organization_id,connection_id,appointment_id,appointment_version,confirmation_request_id,job_type,recipient_e164,payload,valid_until,dedupe_key)
      values (v_appointment.organization_id,v_connection.id,v_appointment.id,v_appointment.version,v_request.id,'MANUAL_OUTBOUND_TEXT',p_sender_e164,jsonb_build_object('message_kind','INVALID_REPLY_PROMPT'),lower(v_appointment.service_period),'v2:'||v_request.id||':invalid:'||v_invalid_count)
      on conflict (organization_id,dedupe_key) do nothing;
      return jsonb_build_object('processed',true,'action','INVALID_PROMPT','attempt',v_invalid_count);
    end if;
    v_action:='ATTENDANT';
  end if;

  if v_action='ATTENDANT' then
    select manager_notification_phone_e164 into v_manager_phone
    from public.whatsapp_automation_settings_v2
    where organization_id=v_appointment.organization_id;
    if v_manager_phone is null then return jsonb_build_object('processed',false,'reason','MANAGER_NOTIFICATION_PHONE_UNAVAILABLE'); end if;
    select coalesce(string_agg(ai.service_name_snapshot,', ' order by ai.position),'Serviço não informado') into v_service_names
    from public.appointment_items ai where ai.appointment_id=v_appointment.id and ai.organization_id=v_appointment.organization_id;
    update public.whatsapp_confirmation_requests_v2
    set status='EXPIRED',responded_at=now(),response_message_id=p_external_message_id,response_action='ATTENDANT',updated_at=now()
    where id=v_request.id;
    insert into public.whatsapp_automation_jobs (organization_id,connection_id,appointment_id,appointment_version,confirmation_request_id,job_type,recipient_e164,payload,valid_until,dedupe_key)
    values (v_appointment.organization_id,v_connection.id,v_appointment.id,v_appointment.version,v_request.id,'MANUAL_OUTBOUND_TEXT',v_manager_phone,
      jsonb_build_object('message_kind','ATTENDANT_REQUEST_MANAGER','customer_name',(select full_name from public.customers where id=v_appointment.customer_id),'customer_phone',p_sender_e164,'barber_name',(select display_name from public.barbers where id=v_appointment.barber_id and organization_id=v_appointment.organization_id),'service_names',v_service_names,'starts_at',lower(v_appointment.service_period),'timezone',(select timezone from public.organizations where id=v_appointment.organization_id)),
      lower(v_appointment.service_period),'v2:'||v_request.id||':attendant') on conflict (organization_id,dedupe_key) do nothing;
    return jsonb_build_object('processed',true,'action','ATTENDANT','request_id',v_request.id);
  end if;

  if v_action not in ('CONFIRM','CANCEL') then return jsonb_build_object('processed',false,'reason','UNSUPPORTED_ACTION'); end if;
  update public.whatsapp_confirmation_requests_v2
  set status=case when v_action='CONFIRM' then 'CONFIRMED'::public.whatsapp_confirmation_status else 'CANCELED'::public.whatsapp_confirmation_status end,
      responded_at=now(),response_message_id=p_external_message_id,response_action=v_action,updated_at=now()
  where id=v_request.id;
  if v_action='CONFIRM' then
    update public.appointments set whatsapp_presence_status='CONFIRMED',whatsapp_presence_confirmed_at=coalesce(whatsapp_presence_confirmed_at,now()),updated_at=now() where id=v_appointment.id;
    insert into public.appointment_status_events (organization_id,appointment_id,from_status,to_status,reason,metadata)
    values (v_appointment.organization_id,v_appointment.id,'CONFIRMED','CONFIRMED','whatsapp_presence_confirmed',jsonb_build_object('confirmation_request_id',v_request.id,'phase',v_request.phase));
    insert into public.whatsapp_automation_jobs (organization_id,connection_id,appointment_id,appointment_version,job_type,recipient_e164,payload,valid_until,dedupe_key)
    values (v_appointment.organization_id,v_connection.id,v_appointment.id,v_appointment.version,'CONFIRMATION_ACK_CLIENT',p_sender_e164,jsonb_build_object('customer_name',(select full_name from public.customers where id=v_appointment.customer_id),'starts_at',lower(v_appointment.service_period),'timezone',(select timezone from public.organizations where id=v_appointment.organization_id)),lower(v_appointment.service_period),'v2:'||v_request.id||':confirm:ack') on conflict (organization_id,dedupe_key) do nothing;
    insert into public.whatsapp_automation_jobs (organization_id,connection_id,appointment_id,appointment_version,job_type,recipient_e164,payload,valid_until,dedupe_key)
    select v_appointment.organization_id,v_connection.id,v_appointment.id,v_appointment.version,'APPOINTMENT_CONFIRMED_STAFF',b.whatsapp_e164,jsonb_build_object('customer_name',(select full_name from public.customers where id=v_appointment.customer_id),'starts_at',lower(v_appointment.service_period),'timezone',(select timezone from public.organizations where id=v_appointment.organization_id)),lower(v_appointment.service_period),'v2:'||v_request.id||':confirm:staff' from public.barbers b where b.id=v_appointment.barber_id and b.organization_id=v_appointment.organization_id and b.whatsapp_e164 is not null on conflict (organization_id,dedupe_key) do nothing;
  else
    perform public.cancel_appointment(v_appointment.id,'Cancelado pelo cliente via WhatsApp',true);
    update public.appointments set cancellation_source='WHATSAPP_CLIENT',cancelled_at=now() where id=v_appointment.id;
    insert into public.whatsapp_automation_jobs (organization_id,connection_id,appointment_id,appointment_version,job_type,recipient_e164,payload,dedupe_key)
    values (v_appointment.organization_id,v_connection.id,v_appointment.id,v_appointment.version,'CANCELLATION_ACK_CLIENT',p_sender_e164,jsonb_build_object('customer_name',(select full_name from public.customers where id=v_appointment.customer_id)),'v2:'||v_request.id||':cancel:ack') on conflict (organization_id,dedupe_key) do nothing;
    insert into public.whatsapp_automation_jobs (organization_id,connection_id,appointment_id,appointment_version,job_type,recipient_e164,payload,dedupe_key)
    select v_appointment.organization_id,v_connection.id,v_appointment.id,v_appointment.version,'APPOINTMENT_CANCELED_STAFF',b.whatsapp_e164,jsonb_build_object('customer_name',(select full_name from public.customers where id=v_appointment.customer_id)),'v2:'||v_request.id||':cancel:staff' from public.barbers b where b.id=v_appointment.barber_id and b.organization_id=v_appointment.organization_id and b.whatsapp_e164 is not null on conflict (organization_id,dedupe_key) do nothing;
  end if;
  return jsonb_build_object('processed',true,'appointment_id',v_appointment.id,'action',v_action,'request_id',v_request.id);
end;
$$;

revoke all on function public.process_whatsapp_v2_text_response(text,text,text,text) from public,anon,authenticated;
grant execute on function public.process_whatsapp_v2_text_response(text,text,text,text) to service_role;
notify pgrst, 'reload schema';
