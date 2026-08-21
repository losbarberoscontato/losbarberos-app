-- Uma resposta numérica não identifica qual atendimento o cliente quis alterar.
-- Por isso, cada cliente recebe somente um fluxo interativo de confirmação por
-- barbearia e dia local: o atendimento confirmado mais cedo daquele dia.
create or replace function public.create_whatsapp_v2_confirmation_request(p_job_id uuid, p_worker_id text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_job public.whatsapp_automation_jobs%rowtype;
  v_phase public.whatsapp_confirmation_phase;
  v_code text;
  v_token text;
  v_id uuid;
  v_customer_id uuid;
  v_timezone text;
  v_local_date date;
  v_first_appointment_id uuid;
begin
  perform public.require_service_role();
  select * into v_job from public.whatsapp_automation_jobs where id=p_job_id for update;
  if not found or v_job.status <> 'PROCESSING' or v_job.locked_by <> p_worker_id then
    raise exception using errcode='22023', message='job not claimed';
  end if;

  if v_job.confirmation_request_id is not null and nullif(v_job.payload ->> 'short_code','') is not null then
    return jsonb_build_object(
      'request_id',v_job.confirmation_request_id,
      'short_code',v_job.payload ->> 'short_code',
      'phase',case when v_job.job_type='REMINDER_MORNING_CLIENT' then 'MORNING' else 'T45' end
    );
  end if;

  select a.customer_id, o.timezone, (lower(a.service_period) at time zone o.timezone)::date
  into v_customer_id, v_timezone, v_local_date
  from public.appointments a
  join public.organizations o on o.id=a.organization_id
  where a.id=v_job.appointment_id and a.organization_id=v_job.organization_id
  for update of a;
  if v_customer_id is null then
    raise exception using errcode='P0002', message='appointment or organization not found';
  end if;

  select a.id into v_first_appointment_id
  from public.appointments a
  where a.organization_id=v_job.organization_id
    and a.customer_id=v_customer_id
    and a.status='CONFIRMED'
    and (lower(a.service_period) at time zone v_timezone)::date=v_local_date
  order by lower(a.service_period), a.id
  limit 1
  for update;

  if v_first_appointment_id is distinct from v_job.appointment_id then
    update public.whatsapp_automation_jobs
    set status='SKIPPED',
        last_error_code='SAME_DAY_CUSTOMER_REMINDER_SUPPRESSED',
        last_error_detail='Another confirmed appointment is the daily WhatsApp confirmation owner.',
        locked_at=null,
        locked_by=null,
        lock_expires_at=null,
        updated_at=now()
    where id=v_job.id;
    return jsonb_build_object('skipped',true,'reason','SAME_DAY_CUSTOMER_REMINDER_SUPPRESSED');
  end if;

  v_phase := case when v_job.job_type='REMINDER_MORNING_CLIENT' then 'MORNING' else 'T45' end;
  if v_phase='T45' then
    update public.whatsapp_confirmation_requests_v2
    set status='SUPERSEDED',updated_at=now()
    where appointment_id=v_job.appointment_id
      and appointment_version=v_job.appointment_version
      and status='PENDING';
  end if;
  v_code := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 6));
  v_token := rtrim(translate(encode(gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  insert into public.whatsapp_confirmation_requests_v2 (
    organization_id, connection_id, appointment_id, appointment_version, job_id,
    phase, opaque_token_hash, short_code_hash, expires_at
  ) values (
    v_job.organization_id, v_job.connection_id, v_job.appointment_id, v_job.appointment_version,
    v_job.id, v_phase, encode(digest(v_token,'sha256'),'hex'),
    encode(digest(v_code,'sha256'),'hex'), v_job.valid_until
  ) returning id into v_id;
  update public.whatsapp_automation_jobs
  set confirmation_request_id=v_id,
      payload=payload || jsonb_build_object('short_code',v_code,'opaque_token',v_token),
      updated_at=now()
  where id=v_job.id;
  return jsonb_build_object('request_id',v_id,'short_code',v_code,'opaque_token',v_token,'phase',v_phase);
end;
$$;

revoke all on function public.create_whatsapp_v2_confirmation_request(uuid, text) from public, anon, authenticated;
grant execute on function public.create_whatsapp_v2_confirmation_request(uuid, text) to service_role;
notify pgrst, 'reload schema';
