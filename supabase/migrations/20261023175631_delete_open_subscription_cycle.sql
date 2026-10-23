create or replace function public.delete_open_subscription_cycle(
  p_organization_id uuid,
  p_subscription_id uuid,
  p_cycle_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subscription public.customer_subscriptions%rowtype;
  v_cycle public.customer_subscription_cycles%rowtype;
  v_entry public.financial_entries%rowtype;
  v_active_entry_count integer;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'subscription cycle write denied';
  end if;

  -- Match payment recording's subscription -> cycle lock order.
  select * into strict v_subscription
    from public.customer_subscriptions
   where id = p_subscription_id and organization_id = p_organization_id
   for update;

  select * into strict v_cycle
    from public.customer_subscription_cycles
   where id = p_cycle_id
     and subscription_id = v_subscription.id
     and organization_id = p_organization_id
   for update;

  -- Retry after a successful request is safe and does not duplicate the event.
  if v_cycle.status = 'CANCELED' then return; end if;
  if v_cycle.status not in ('OPEN', 'OVERDUE') then
    raise exception using errcode = '22023', message = 'paid subscription cycle cannot be deleted';
  end if;

  if exists (
    select 1 from public.subscription_payments payment
     where payment.organization_id = p_organization_id
       and payment.subscription_id = v_subscription.id
       and payment.cycle_id = v_cycle.id
  ) then
    raise exception using errcode = '22023', message = 'paid subscription cycle cannot be deleted';
  end if;

  if exists (
    select 1 from public.customer_subscription_sessions session
     where session.organization_id = p_organization_id
       and session.cycle_id = v_cycle.id
       and session.status not in ('AVAILABLE', 'CANCELED')
  ) then
    raise exception using errcode = '22023', message = 'subscription cycle has scheduled or completed sessions';
  end if;

  if v_cycle.financial_entry_id is not null then
    select * into v_entry
      from public.financial_entries entry
     where entry.id = v_cycle.financial_entry_id
       and entry.organization_id = p_organization_id
       and entry.source = 'SUBSCRIPTION'
       and entry.subscription_cycle_id = v_cycle.id
     for update;
    if v_entry.id is null then
      raise exception using errcode = '23503', message = 'subscription cycle financial entry is inconsistent';
    end if;
  else
    select count(*) into v_active_entry_count
      from public.financial_entries entry
     where entry.organization_id = p_organization_id
       and entry.source = 'SUBSCRIPTION'
       and entry.subscription_cycle_id = v_cycle.id
       and entry.canceled_at is null;
    if v_active_entry_count > 1 then
      raise exception using errcode = '23514', message = 'subscription cycle has multiple active financial entries';
    end if;
    select * into v_entry
      from public.financial_entries entry
     where entry.organization_id = p_organization_id
       and entry.source = 'SUBSCRIPTION'
       and entry.subscription_cycle_id = v_cycle.id
       and entry.canceled_at is null
     for update;
  end if;

  if v_entry.id is not null then
    if exists (
      select 1 from public.financial_settlements settlement
       where settlement.organization_id = p_organization_id
         and settlement.entry_id = v_entry.id
    ) then
      raise exception using errcode = '22023', message = 'settled subscription cycle requires reversal';
    end if;
    if v_entry.canceled_at is null then
      perform public.cancel_financial_entry(v_entry.id, 'Parcela de assinatura excluída pelo gestor');
    end if;
  end if;

  update public.customer_subscription_sessions
     set status = 'CANCELED', canceled_at = now()
   where organization_id = p_organization_id
     and cycle_id = v_cycle.id
     and status = 'AVAILABLE';

  update public.customer_subscription_cycles
     set status = 'CANCELED', canceled_at = now()
   where id = v_cycle.id and organization_id = p_organization_id;

  insert into public.subscription_events(
    organization_id, subscription_id, event_type, actor_user_id, idempotency_key, metadata
  ) values (
    p_organization_id,
    v_subscription.id,
    'CYCLE_CANCELED',
    auth.uid(),
    'cycle-deleted:' || v_cycle.id,
    jsonb_build_object('cycle_id', v_cycle.id, 'cycle_number', v_cycle.cycle_number, 'reason', 'manager_deleted_open_installment')
  ) on conflict (organization_id, idempotency_key) do nothing;
end;
$$;

revoke all on function public.delete_open_subscription_cycle(uuid, uuid, uuid) from public, anon;
grant execute on function public.delete_open_subscription_cycle(uuid, uuid, uuid) to authenticated;
