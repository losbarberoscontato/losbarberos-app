-- A canceled project contract remains available for financial and customer history,
-- but it no longer belongs to an operational Kanban lane.
update public.project_engagements
   set kanban_received_at = null,
       kanban_received_by = null,
       kanban_received_by_name = null,
       event_due_on = null,
       updated_at = now()
 where status = 'CANCELED'
   and (kanban_board_id is not null or kanban_received_at is not null
        or kanban_received_by is not null or kanban_received_by_name is not null
        or event_due_on is not null);

create or replace function public.confirm_customer_project_cancellation(
  p_organization_id uuid, p_engagement_id uuid, p_last_installment_id uuid,
  p_last_session_id uuid, p_reason text, p_observations text default null, p_request_id uuid default null
)
returns public.project_engagements
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_engagement public.project_engagements%rowtype;
  v_request public.customer_project_cancellation_requests%rowtype;
  v_cutoff_installment integer;
  v_cutoff_session integer;
  v_installment public.project_installments%rowtype;
  v_session public.project_engagement_sessions%rowtype;
  v_today date;
  v_timezone text;
  v_item record;
  v_reason text := upper(btrim(coalesce(p_reason, '')));
  v_observations text := nullif(btrim(coalesce(p_observations, '')), '');
begin
  if auth.uid() is null or not public.is_organization_owner(p_organization_id)
     or not public.organization_allows_management_mutations(p_organization_id) then
    raise exception using errcode = '42501', message = 'project cancellation confirmation denied';
  end if;
  select * into strict v_engagement from public.project_engagements
   where id = p_engagement_id and organization_id = p_organization_id for update;
  if p_request_id is null and v_engagement.status <> 'ACTIVE' then raise exception using errcode = '22023', message = 'project contract cannot be canceled'; end if;
  select timezone into v_timezone from public.organizations where id = p_organization_id;
  v_today := (now() at time zone coalesce(v_timezone, 'America/Sao_Paulo'))::date;
  if p_request_id is not null then
    select * into strict v_request from public.customer_project_cancellation_requests
     where id = p_request_id and engagement_id = v_engagement.id and organization_id = p_organization_id for update;
    if v_request.status = 'CONFIRMED' then return v_engagement; end if;
    if v_request.status <> 'PENDING' then raise exception using errcode = '22023', message = 'project cancellation request is not pending'; end if;
    if v_engagement.status <> 'ACTIVE' then raise exception using errcode = '22023', message = 'project contract cannot be canceled'; end if;
    p_last_session_id := v_request.last_session_id;
    v_reason := v_request.reason;
    v_observations := v_request.observations;
  else
    if v_reason not in ('FINANCIAL_DIFFICULTY', 'LACK_OF_TIME', 'ADDRESS_CHANGE', 'OTHER')
       or (v_reason = 'OTHER' and v_observations is null) or char_length(coalesce(v_observations, '')) > 2000 then
      raise exception using errcode = '22023', message = 'invalid project cancellation reason or observations';
    end if;
    insert into public.customer_project_cancellation_requests(
      organization_id, engagement_id, customer_id, status, reason, observations, last_session_id,
      requested_by, confirmed_by, confirmed_at
    ) values (p_organization_id, v_engagement.id, v_engagement.customer_id, 'CONFIRMED', v_reason,
      v_observations, p_last_session_id, auth.uid(), auth.uid(), now()) returning * into v_request;
  end if;
  if p_last_installment_id is not null then
    select * into strict v_installment from public.project_installments
     where id = p_last_installment_id and engagement_id = v_engagement.id and organization_id = p_organization_id
       and status in ('OPEN', 'PAID') for update;
    v_cutoff_installment := v_installment.installment_number;
  end if;
  if p_last_session_id is not null then
    select * into strict v_session from public.project_engagement_sessions
     where id = p_last_session_id and engagement_id = v_engagement.id and organization_id = p_organization_id
       and status in ('OPEN', 'BOOKED', 'COMPLETED', 'CANCELED') for update;
    v_cutoff_session := v_session.session_number;
  end if;

  -- Keep past-due and partially settled charges so their outstanding debt is preserved.
  for v_item in
    select entry.id as financial_entry_id
      from public.project_installments installment
      join public.financial_entries entry on entry.project_installment_id = installment.id
        and entry.organization_id = installment.organization_id and entry.source = 'PROJECT'
     where installment.engagement_id = v_engagement.id and installment.organization_id = p_organization_id
       and installment.status = 'OPEN' and installment.due_on > v_today
       and (v_cutoff_installment is null or installment.installment_number > v_cutoff_installment)
       and entry.canceled_at is null
       and not exists (select 1 from public.financial_settlements settlement where settlement.organization_id = p_organization_id and settlement.entry_id = entry.id)
     for update of installment, entry
  loop
    perform public.cancel_financial_entry(v_item.financial_entry_id, 'Cancelamento do contrato de projeto');
  end loop;
  update public.project_installments installment set status = 'CANCELED'
   where installment.engagement_id = v_engagement.id and installment.organization_id = p_organization_id
     and installment.status = 'OPEN' and installment.due_on > v_today
     and (v_cutoff_installment is null or installment.installment_number > v_cutoff_installment)
     and not exists (select 1 from public.financial_entries entry join public.financial_settlements settlement
       on settlement.organization_id = entry.organization_id and settlement.entry_id = entry.id
       where entry.organization_id = installment.organization_id and entry.project_installment_id = installment.id);

  for v_item in
    select session.id, session.status, session.appointment_id, appointment.status as appointment_status
      from public.project_engagement_sessions session
      left join public.appointments appointment on appointment.id = session.appointment_id and appointment.organization_id = session.organization_id
     where session.engagement_id = v_engagement.id and session.organization_id = p_organization_id
       and session.status in ('OPEN', 'BOOKED')
       and (v_cutoff_session is null or session.session_number > v_cutoff_session)
     order by session.session_number for update of session
  loop
    if v_item.status = 'BOOKED' and v_item.appointment_id is not null
       and v_item.appointment_status in ('HELD', 'PENDING_PAYMENT', 'CONFIRMED') then
      perform public.cancel_appointment(v_item.appointment_id, 'Cancelamento de projeto confirmado pelo gestor', false);
    end if;
    update public.project_engagement_sessions set status = 'CANCELED', appointment_id = null, updated_at = now()
     where id = v_item.id and organization_id = p_organization_id;
  end loop;
  update public.project_engagements
     set status = 'CANCELED', kanban_received_at = null,
         kanban_received_by = null, kanban_received_by_name = null, event_due_on = null, updated_at = now()
   where id = v_engagement.id and organization_id = p_organization_id returning * into v_engagement;
  update public.customer_project_cancellation_requests set status = 'CONFIRMED', last_installment_id = p_last_installment_id,
    confirmed_by = auth.uid(), confirmed_at = coalesce(confirmed_at, now())
   where id = v_request.id and organization_id = p_organization_id;
  update public.manager_notifications set read_at = coalesce(read_at, now())
   where organization_id = p_organization_id and engagement_id = v_engagement.id and kind = 'PROJECT_CANCELLATION_REQUEST';
  return v_engagement;
exception when no_data_found then
  raise exception using errcode = 'P0002', message = 'project contract, request or cutoff not found';
end $$;
revoke all on function public.confirm_customer_project_cancellation(uuid, uuid, uuid, uuid, text, text, uuid) from public, anon;
grant execute on function public.confirm_customer_project_cancellation(uuid, uuid, uuid, uuid, text, text, uuid) to authenticated;
