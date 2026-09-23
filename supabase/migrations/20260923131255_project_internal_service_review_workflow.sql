-- Separa o aviso do profissional ao gestor da conclusão financeira do gestor.
alter table public.project_engagement_internal_services
  drop constraint if exists project_engagement_internal_services_status_check;
alter table public.project_engagement_internal_services
  add constraint project_engagement_internal_services_status_check
  check (status in ('OPEN', 'READY_FOR_REVIEW', 'COMPLETED'));
alter table public.project_engagement_internal_services
  add column if not exists review_requested_at timestamptz,
  add column if not exists review_requested_by uuid references auth.users(id);

-- O profissional informa a data uma única vez. Isso não conclui o serviço.
create or replace function public.barber_set_project_internal_service_delivery(
  p_organization_id uuid, p_project_id uuid, p_internal_service_id uuid, p_delivery_on date
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_delivery_on is null then raise exception using errcode='22023', message='delivery date is required'; end if;
  if not public.is_barber_project_member(p_organization_id, p_project_id) then raise exception using errcode='42501', message='project access denied'; end if;
  update public.project_engagement_internal_services s
     set delivery_on = p_delivery_on, updated_at = now()
   where s.id = p_internal_service_id and s.organization_id = p_organization_id and s.project_id = p_project_id
     and s.barber_id = (select b.id from public.barbers b where b.organization_id = p_organization_id and b.auth_user_id = auth.uid() and b.active limit 1)
     and s.delivery_on is null and s.status = 'OPEN';
  if not found then raise exception using errcode='42501', message='service is not assigned or already delivered'; end if;
end;
$$;

create or replace function public.barber_submit_project_internal_service_review(
  p_organization_id uuid, p_project_id uuid, p_internal_service_id uuid
)
returns public.project_engagement_internal_services
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_result public.project_engagement_internal_services%rowtype;
begin
  if not public.is_barber_project_member(p_organization_id, p_project_id) then raise exception using errcode='42501', message='project access denied'; end if;
  update public.project_engagement_internal_services s
     set status = 'READY_FOR_REVIEW', review_requested_at = now(), review_requested_by = auth.uid(), updated_at = now()
   where s.id = p_internal_service_id and s.organization_id = p_organization_id and s.project_id = p_project_id
     and s.barber_id = (select b.id from public.barbers b where b.organization_id = p_organization_id and b.auth_user_id = auth.uid() and b.active limit 1)
     and s.delivery_on is not null and s.status = 'OPEN'
   returning s.* into v_result;
  if not found then raise exception using errcode='42501', message='service is not ready for review'; end if;
  return v_result;
end;
$$;

-- Somente o gestor conclui financeiramente e cria o lançamento de comissão.
create or replace function public.complete_project_engagement_internal_service(
  p_organization_id uuid, p_internal_service_id uuid, p_idempotency_key text
)
returns public.project_engagement_internal_services
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_service public.project_engagement_internal_services%rowtype;
  v_engagement public.project_engagements%rowtype;
  v_card public.project_kanban_internal_cards%rowtype;
  v_ledger_id uuid;
  v_key text;
begin
  perform public.require_financial_owner(p_organization_id, 'complete project internal service');
  select * into v_service from public.project_engagement_internal_services where organization_id = p_organization_id and id = p_internal_service_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'project internal service not found'; end if;
  if v_service.status = 'COMPLETED' then return v_service; end if;
  if v_service.status not in ('OPEN', 'READY_FOR_REVIEW') then raise exception using errcode = '22023', message = 'invalid internal service status'; end if;
  if v_service.engagement_id is not null then
    select * into v_engagement from public.project_engagements where organization_id = p_organization_id and id = v_service.engagement_id for update;
    if not found or v_engagement.kanban_board_id is distinct from v_service.kanban_board_id then raise exception using errcode = '22023', message = 'move the engagement to another board before completing this service'; end if;
  else
    select * into v_card from public.project_kanban_internal_cards where organization_id = p_organization_id and id = v_service.internal_card_id for update;
    if not found or v_card.kanban_board_id is distinct from v_service.kanban_board_id then raise exception using errcode = '22023', message = 'move the standalone card to another board before completing this service'; end if;
  end if;
  if v_service.delivery_on is null then raise exception using errcode = '22023', message = 'delivery date is required before completion'; end if;
  v_key := 'project-internal-service:' || v_service.id || ':commission:v1';
  if v_service.commission_cents > 0 and p_idempotency_key is distinct from v_key then raise exception using errcode = '22023', message = 'invalid internal service idempotency key'; end if;
  update public.project_engagement_internal_services set status = 'COMPLETED', updated_at = now() where organization_id = p_organization_id and id = p_internal_service_id returning * into v_service;
  if v_service.commission_cents > 0 then
    insert into public.commission_ledger (organization_id, barber_id, appointment_id, appointment_item_id, project_internal_service_id, kind, amount_cents, idempotency_key, earned_at, created_by)
    values (p_organization_id, v_service.barber_id, null, null, v_service.id, 'EARNED', v_service.commission_cents, v_key, v_service.delivery_on::timestamp at time zone 'America/Sao_Paulo', auth.uid())
    on conflict (organization_id, idempotency_key) do nothing returning id into v_ledger_id;
    if v_ledger_id is null then select id into v_ledger_id from public.commission_ledger where organization_id = p_organization_id and idempotency_key = v_key; end if;
    update public.project_engagement_internal_services set commission_ledger_entry_id = v_ledger_id where organization_id = p_organization_id and id = p_internal_service_id returning * into v_service;
  end if;
  return v_service;
end;
$$;

revoke all on function public.barber_set_project_internal_service_delivery(uuid, uuid, uuid, date), public.barber_submit_project_internal_service_review(uuid, uuid, uuid), public.complete_project_engagement_internal_service(uuid, uuid, text) from public, anon, service_role;
grant execute on function public.barber_set_project_internal_service_delivery(uuid, uuid, uuid, date), public.barber_submit_project_internal_service_review(uuid, uuid, uuid), public.complete_project_engagement_internal_service(uuid, uuid, text) to authenticated;

create or replace function public.manager_update_project_internal_service(
  p_organization_id uuid, p_project_id uuid, p_internal_service_id uuid,
  p_commission_cents integer, p_delivery_on date
)
returns public.project_engagement_internal_services
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_result public.project_engagement_internal_services%rowtype;
begin
  perform public.require_financial_owner(p_organization_id, 'update project internal service');
  if p_commission_cents < 0 then raise exception using errcode='22023', message='commission cannot be negative'; end if;
  update public.project_engagement_internal_services
     set commission_cents = p_commission_cents, delivery_on = p_delivery_on, updated_at = now()
   where id = p_internal_service_id and organization_id = p_organization_id and project_id = p_project_id
     and status in ('OPEN', 'READY_FOR_REVIEW')
   returning * into v_result;
  if not found then raise exception using errcode='P0002', message='internal service not found or already completed'; end if;
  return v_result;
end;
$$;

revoke all on function public.manager_update_project_internal_service(uuid, uuid, uuid, integer, date) from public, anon, service_role;
grant execute on function public.manager_update_project_internal_service(uuid, uuid, uuid, integer, date) to authenticated;
