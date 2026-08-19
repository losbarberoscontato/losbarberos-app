-- Evolution can emit the legacy Brazilian mobile JID without the ninth digit.
-- Compare only the appointment customer already bound to a valid code.
create or replace function public.whatsapp_v2_phone_matches(p_expected text, p_received text)
returns boolean language sql immutable set search_path = pg_temp as $$
  with phones as (
    select regexp_replace(coalesce(p_expected,''), '\D', '', 'g') as expected_digits,
           regexp_replace(coalesce(p_received,''), '\D', '', 'g') as received_digits
  )
  select expected_digits = received_digits
    or (
      left(expected_digits, 2) = '55' and left(received_digits, 2) = '55'
      and (
        (length(expected_digits) = 13 and length(received_digits) = 12 and substr(expected_digits,5,1) = '9' and substr(expected_digits,1,4) || substr(expected_digits,6) = received_digits)
        or
        (length(expected_digits) = 12 and length(received_digits) = 13 and substr(received_digits,5,1) = '9' and expected_digits = substr(received_digits,1,4) || substr(received_digits,6))
      )
    )
  from phones
$$;

create or replace function public.process_whatsapp_v2_text_response(
  p_gateway_instance_id text, p_sender_e164 text, p_external_message_id text, p_action text, p_short_code text
) returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_connection public.whatsapp_business_connections%rowtype; v_request public.whatsapp_confirmation_requests_v2%rowtype; v_appointment public.appointments%rowtype; v_customer_id uuid; v_action text:=upper(btrim(p_action));
begin
  perform public.require_service_role();
  select * into v_connection from public.whatsapp_business_connections where provider='QR_WEB' and gateway_instance_id=p_gateway_instance_id and is_active and status='CONNECTED' for update;
  if not found then return jsonb_build_object('processed',false,'reason','UNKNOWN_CONNECTION'); end if;
  select * into v_request from public.whatsapp_confirmation_requests_v2 where connection_id=v_connection.id and short_code_hash=encode(digest(upper(btrim(p_short_code)),'sha256'),'hex') and status='PENDING' and expires_at>now() for update;
  if not found then return jsonb_build_object('processed',false,'reason','NO_ACTIVE_REQUEST'); end if;
  select * into v_appointment from public.appointments where id=v_request.appointment_id and organization_id=v_request.organization_id for update;
  select id into v_customer_id from public.customers where id=v_appointment.customer_id and organization_id=v_appointment.organization_id and public.whatsapp_v2_phone_matches(phone_e164,p_sender_e164);
  if v_customer_id is null then return jsonb_build_object('processed',false,'reason','SENDER_MISMATCH'); end if;
  if v_appointment.version <> v_request.appointment_version or v_appointment.status not in ('CONFIRMED') then return jsonb_build_object('processed',false,'reason','APPOINTMENT_NOT_ACTIVE'); end if;
  if v_action not in ('CONFIRM','CANCEL') then return jsonb_build_object('processed',false,'reason','UNSUPPORTED_ACTION'); end if;
  update public.whatsapp_confirmation_requests_v2 set status=case when v_action='CONFIRM' then 'CONFIRMED'::public.whatsapp_confirmation_status else 'CANCELED'::public.whatsapp_confirmation_status end, responded_at=now(), response_message_id=p_external_message_id, response_action=v_action, updated_at=now() where id=v_request.id;
  if v_action='CONFIRM' then
    update public.appointments set whatsapp_presence_status='CONFIRMED', whatsapp_presence_confirmed_at=coalesce(whatsapp_presence_confirmed_at,now()), updated_at=now() where id=v_appointment.id;
    insert into public.appointment_status_events (organization_id,appointment_id,from_status,to_status,reason,metadata) values (v_appointment.organization_id,v_appointment.id,'CONFIRMED','CONFIRMED','whatsapp_presence_confirmed',jsonb_build_object('confirmation_request_id',v_request.id,'phase',v_request.phase));
    insert into public.whatsapp_automation_jobs (organization_id,connection_id,appointment_id,appointment_version,job_type,recipient_e164,payload,valid_until,dedupe_key)
    values (v_appointment.organization_id,v_connection.id,v_appointment.id,v_appointment.version,'CONFIRMATION_ACK_CLIENT',p_sender_e164,jsonb_build_object('customer_name',(select full_name from public.customers where id=v_appointment.customer_id),'starts_at',lower(v_appointment.service_period),'timezone',(select timezone from public.organizations where id=v_appointment.organization_id)),lower(v_appointment.service_period),'v2:' || v_request.id || ':confirm:ack') on conflict (organization_id,dedupe_key) do nothing;
    insert into public.whatsapp_automation_jobs (organization_id,connection_id,appointment_id,appointment_version,job_type,recipient_e164,payload,valid_until,dedupe_key)
    select v_appointment.organization_id,v_connection.id,v_appointment.id,v_appointment.version,'APPOINTMENT_CONFIRMED_STAFF',b.whatsapp_e164,jsonb_build_object('customer_name',(select full_name from public.customers where id=v_appointment.customer_id),'starts_at',lower(v_appointment.service_period),'timezone',(select timezone from public.organizations where id=v_appointment.organization_id)),lower(v_appointment.service_period),'v2:' || v_request.id || ':confirm:staff' from public.barbers b where b.id=v_appointment.barber_id and b.organization_id=v_appointment.organization_id and b.whatsapp_e164 is not null on conflict (organization_id,dedupe_key) do nothing;
  else
    perform public.cancel_appointment(v_appointment.id,'Cancelado pelo cliente via WhatsApp',true);
    update public.appointments set cancellation_source='WHATSAPP_CLIENT', cancelled_at=now() where id=v_appointment.id;
    insert into public.whatsapp_automation_jobs (organization_id,connection_id,appointment_id,appointment_version,job_type,recipient_e164,payload,dedupe_key)
    values (v_appointment.organization_id,v_connection.id,v_appointment.id,v_appointment.version,'CANCELLATION_ACK_CLIENT',p_sender_e164,jsonb_build_object('customer_name',(select full_name from public.customers where id=v_appointment.customer_id)),'v2:' || v_request.id || ':cancel:ack') on conflict (organization_id,dedupe_key) do nothing;
    insert into public.whatsapp_automation_jobs (organization_id,connection_id,appointment_id,appointment_version,job_type,recipient_e164,payload,dedupe_key)
    select v_appointment.organization_id,v_connection.id,v_appointment.id,v_appointment.version,'APPOINTMENT_CANCELED_STAFF',b.whatsapp_e164,jsonb_build_object('customer_name',(select full_name from public.customers where id=v_appointment.customer_id)),'v2:' || v_request.id || ':cancel:staff' from public.barbers b where b.id=v_appointment.barber_id and b.organization_id=v_appointment.organization_id and b.whatsapp_e164 is not null on conflict (organization_id,dedupe_key) do nothing;
  end if;
  return jsonb_build_object('processed',true,'appointment_id',v_appointment.id,'action',v_action,'request_id',v_request.id);
end;
$$;

revoke all on function public.whatsapp_v2_phone_matches(text,text), public.process_whatsapp_v2_text_response(text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.process_whatsapp_v2_text_response(text,text,text,text,text) to service_role;
