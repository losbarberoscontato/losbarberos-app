-- Replies use only 1, 2, or 3. Internal tokens remain private.
alter table public.whatsapp_confirmation_requests_v2
  add column if not exists invalid_reply_count smallint not null default 0
  check (invalid_reply_count between 0 and 3);

alter table public.whatsapp_confirmation_requests_v2
  drop constraint if exists whatsapp_confirmation_requests_v2_response_action_check;
alter table public.whatsapp_confirmation_requests_v2
  add constraint whatsapp_confirmation_requests_v2_response_action_check
  check (response_action in ('CONFIRM', 'CANCEL', 'ATTENDANT'));

drop function if exists public.process_whatsapp_v2_text_response(text, text, text, text, text);

create function public.process_whatsapp_v2_text_response(
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
    v_manager_phone:=v_connection.connected_phone_e164;
    if v_manager_phone is null then return jsonb_build_object('processed',false,'reason','CONNECTED_MANAGER_PHONE_UNAVAILABLE'); end if;
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
