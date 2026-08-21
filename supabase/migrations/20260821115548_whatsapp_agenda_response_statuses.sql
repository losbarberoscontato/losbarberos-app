-- Agenda keeps its operational status (CONFIRMED/CANCELED/etc.) for availability
-- and finance. This response status is the client-facing confirmation workflow.
alter type public.appointment_whatsapp_response_status
  add value if not exists 'CONTACT_REQUESTED_BY_WHATSAPP';
alter type public.appointment_whatsapp_response_status
  add value if not exists 'CONFIRMED_MANUALLY';

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
  v_candidate record;
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

  -- Respostas simples (1/2/3) não carregam o id do atendimento. Para requests
  -- legadas duplicadas, recuperamos de forma determinística o atendimento mais
  -- próximo e encerramos os demais requests pendentes, evitando bloquear o fluxo.
  for v_candidate in
    select r.id
    from public.whatsapp_confirmation_requests_v2 r
    join public.appointments a on a.id=r.appointment_id and a.organization_id=r.organization_id
    join public.customers c on c.id=a.customer_id and c.organization_id=a.organization_id
    where r.connection_id=v_connection.id and r.status='PENDING' and r.expires_at>now()
      and a.version=r.appointment_version and a.status='CONFIRMED'
      and public.whatsapp_v2_phone_matches(c.phone_e164,p_sender_e164)
    order by lower(a.service_period), r.created_at, r.id
    for update of r
  loop
    if v_request.id is null then
      select * into v_request from public.whatsapp_confirmation_requests_v2 where id=v_candidate.id;
    else
      update public.whatsapp_confirmation_requests_v2
      set status='SUPERSEDED',updated_at=now()
      where id=v_candidate.id;
    end if;
  end loop;
  if v_request.id is null then return jsonb_build_object('processed',false,'reason','NO_ACTIVE_REQUEST'); end if;
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
    update public.appointments
    set whatsapp_response_status='CONTACT_REQUESTED_BY_WHATSAPP',updated_at=now()
    where id=v_appointment.id and organization_id=v_appointment.organization_id;
    insert into public.appointment_status_events (organization_id,appointment_id,from_status,to_status,reason,metadata)
    values (v_appointment.organization_id,v_appointment.id,v_appointment.status,v_appointment.status,'whatsapp_contact_requested',jsonb_build_object('confirmation_request_id',v_request.id,'phase',v_request.phase));
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
    update public.appointments
    set whatsapp_presence_status='CONFIRMED',whatsapp_presence_confirmed_at=coalesce(whatsapp_presence_confirmed_at,now()),whatsapp_response_status='CONFIRMED_BY_WHATSAPP',updated_at=now()
    where id=v_appointment.id and organization_id=v_appointment.organization_id;
    insert into public.appointment_status_events (organization_id,appointment_id,from_status,to_status,reason,metadata)
    values (v_appointment.organization_id,v_appointment.id,'CONFIRMED','CONFIRMED','whatsapp_presence_confirmed',jsonb_build_object('confirmation_request_id',v_request.id,'phase',v_request.phase,'whatsapp_response_status','CONFIRMED_BY_WHATSAPP'));
    insert into public.whatsapp_automation_jobs (organization_id,connection_id,appointment_id,appointment_version,job_type,recipient_e164,payload,valid_until,dedupe_key)
    values (v_appointment.organization_id,v_connection.id,v_appointment.id,v_appointment.version,'CONFIRMATION_ACK_CLIENT',p_sender_e164,jsonb_build_object('customer_name',(select full_name from public.customers where id=v_appointment.customer_id),'starts_at',lower(v_appointment.service_period),'timezone',(select timezone from public.organizations where id=v_appointment.organization_id)),lower(v_appointment.service_period),'v2:'||v_request.id||':confirm:ack') on conflict (organization_id,dedupe_key) do nothing;
    insert into public.whatsapp_automation_jobs (organization_id,connection_id,appointment_id,appointment_version,job_type,recipient_e164,payload,valid_until,dedupe_key)
    select v_appointment.organization_id,v_connection.id,v_appointment.id,v_appointment.version,'APPOINTMENT_CONFIRMED_STAFF',b.whatsapp_e164,jsonb_build_object('customer_name',(select full_name from public.customers where id=v_appointment.customer_id),'starts_at',lower(v_appointment.service_period),'timezone',(select timezone from public.organizations where id=v_appointment.organization_id)),lower(v_appointment.service_period),'v2:'||v_request.id||':confirm:staff' from public.barbers b where b.id=v_appointment.barber_id and b.organization_id=v_appointment.organization_id and b.whatsapp_e164 is not null on conflict (organization_id,dedupe_key) do nothing;
  else
    perform public.cancel_appointment(v_appointment.id,'Cancelado pelo cliente via WhatsApp',true);
    update public.appointments
    set cancellation_source='WHATSAPP_CLIENT',cancelled_at=now(),whatsapp_response_status='CANCELED_BY_WHATSAPP'
    where id=v_appointment.id and organization_id=v_appointment.organization_id;
    insert into public.appointment_status_events (organization_id,appointment_id,from_status,to_status,reason,metadata)
    values (v_appointment.organization_id,v_appointment.id,'CANCELED','CANCELED','whatsapp_canceled',jsonb_build_object('confirmation_request_id',v_request.id,'phase',v_request.phase,'whatsapp_response_status','CANCELED_BY_WHATSAPP'));
    insert into public.whatsapp_automation_jobs (organization_id,connection_id,appointment_id,appointment_version,job_type,recipient_e164,payload,dedupe_key)
    values (v_appointment.organization_id,v_connection.id,v_appointment.id,v_appointment.version,'CANCELLATION_ACK_CLIENT',p_sender_e164,jsonb_build_object('customer_name',(select full_name from public.customers where id=v_appointment.customer_id)),'v2:'||v_request.id||':cancel:ack') on conflict (organization_id,dedupe_key) do nothing;
    insert into public.whatsapp_automation_jobs (organization_id,connection_id,appointment_id,appointment_version,job_type,recipient_e164,payload,dedupe_key)
    select v_appointment.organization_id,v_connection.id,v_appointment.id,v_appointment.version,'APPOINTMENT_CANCELED_STAFF',b.whatsapp_e164,jsonb_build_object('customer_name',(select full_name from public.customers where id=v_appointment.customer_id)),'v2:'||v_request.id||':cancel:staff' from public.barbers b where b.id=v_appointment.barber_id and b.organization_id=v_appointment.organization_id and b.whatsapp_e164 is not null on conflict (organization_id,dedupe_key) do nothing;
  end if;
  return jsonb_build_object('processed',true,'appointment_id',v_appointment.id,'action',v_action,'request_id',v_request.id);
end;
$$;

create or replace function public.confirm_appointment_manually_by_whatsapp(
  p_appointment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_appointment public.appointments%rowtype;
  v_connection public.whatsapp_business_connections%rowtype;
  v_customer public.customers%rowtype;
  v_barber public.barbers%rowtype;
  v_timezone text;
begin
  select * into strict v_appointment from public.appointments where id=p_appointment_id for update;
  if not public.is_organization_owner(v_appointment.organization_id) then
    raise exception using errcode='42501', message='organization owner required';
  end if;
  if not public.organization_allows_existing_operations(v_appointment.organization_id) then
    raise exception using errcode='42501', message='organization access does not allow appointment operations';
  end if;
  if v_appointment.status <> 'CONFIRMED' then
    raise exception using errcode='22023', message='appointment must be operationally confirmed';
  end if;
  if v_appointment.whatsapp_response_status in ('CONFIRMED_BY_WHATSAPP','CONFIRMED_MANUALLY') then
    raise exception using errcode='22023', message='appointment is already confirmed';
  end if;
  select * into strict v_customer from public.customers where id=v_appointment.customer_id and organization_id=v_appointment.organization_id;
  select * into strict v_barber from public.barbers where id=v_appointment.barber_id and organization_id=v_appointment.organization_id;
  if v_customer.phone_e164 is null then
    raise exception using errcode='22023', message='customer WhatsApp is required';
  end if;
  if v_barber.whatsapp_e164 is null then
    raise exception using errcode='22023', message='barber WhatsApp is required';
  end if;
  if not public.whatsapp_v2_consented(v_appointment.organization_id,v_customer.id) then
    raise exception using errcode='42501', message='customer WhatsApp transactional consent is required';
  end if;
  select c.* into strict v_connection
  from public.whatsapp_business_connections c
  join public.whatsapp_automation_settings_v2 s on s.organization_id=c.organization_id
  where c.organization_id=v_appointment.organization_id and c.provider='QR_WEB' and c.is_active and c.status='CONNECTED'
    and s.mode='ACTIVE' and not s.dispatch_paused
  for update;
  select timezone into strict v_timezone from public.organizations where id=v_appointment.organization_id;

  update public.whatsapp_confirmation_requests_v2
  set status='EXPIRED',updated_at=now()
  where appointment_id=v_appointment.id and organization_id=v_appointment.organization_id and status='PENDING';
  update public.whatsapp_automation_jobs
  set status='CANCELED',last_error_code='MANUAL_CONFIRMATION_SUPERSEDED_REMINDER',updated_at=now()
  where appointment_id=v_appointment.id and organization_id=v_appointment.organization_id
    and status in ('PENDING','RETRY') and job_type in ('REMINDER_MORNING_CLIENT','REMINDER_T45_CLIENT');
  update public.appointments
  set whatsapp_response_status='CONFIRMED_MANUALLY',updated_at=now()
  where id=v_appointment.id and organization_id=v_appointment.organization_id;
  insert into public.appointment_status_events (organization_id,appointment_id,from_status,to_status,reason,actor_user_id,metadata)
  values (v_appointment.organization_id,v_appointment.id,v_appointment.status,v_appointment.status,'manual_whatsapp_confirmation_requested',auth.uid(),jsonb_build_object('whatsapp_response_status','CONFIRMED_MANUALLY'));
  insert into public.whatsapp_automation_jobs (organization_id,connection_id,appointment_id,appointment_version,job_type,recipient_e164,payload,valid_until,dedupe_key)
  values (v_appointment.organization_id,v_connection.id,v_appointment.id,v_appointment.version,'MANUAL_OUTBOUND_TEXT',v_customer.phone_e164,
    jsonb_build_object('message_kind','MANUAL_CONFIRMATION_CLIENT','customer_name',v_customer.full_name,'barber_name',v_barber.display_name,'starts_at',lower(v_appointment.service_period),'timezone',v_timezone),lower(v_appointment.service_period),'v2:'||v_appointment.id||':v'||v_appointment.version||':manual-confirm:client')
  on conflict (organization_id,dedupe_key) do nothing;
  insert into public.whatsapp_automation_jobs (organization_id,connection_id,appointment_id,appointment_version,job_type,recipient_e164,payload,valid_until,dedupe_key)
  values (v_appointment.organization_id,v_connection.id,v_appointment.id,v_appointment.version,'MANUAL_OUTBOUND_TEXT',v_barber.whatsapp_e164,
    jsonb_build_object('message_kind','MANUAL_CONFIRMATION_STAFF','customer_name',v_customer.full_name,'barber_name',v_barber.display_name,'starts_at',lower(v_appointment.service_period),'timezone',v_timezone),lower(v_appointment.service_period),'v2:'||v_appointment.id||':v'||v_appointment.version||':manual-confirm:staff')
  on conflict (organization_id,dedupe_key) do nothing;
  return jsonb_build_object('appointment_id',v_appointment.id,'whatsapp_response_status','CONFIRMED_MANUALLY');
exception when no_data_found then
  raise exception using errcode='P0002', message='appointment, active WhatsApp connection, customer, or barber not found';
end;
$$;

revoke all on function public.process_whatsapp_v2_text_response(text,text,text,text) from public,anon,authenticated;
grant execute on function public.process_whatsapp_v2_text_response(text,text,text,text) to service_role;
revoke all on function public.confirm_appointment_manually_by_whatsapp(uuid) from public,anon;
grant execute on function public.confirm_appointment_manually_by_whatsapp(uuid) to authenticated;
notify pgrst, 'reload schema';
