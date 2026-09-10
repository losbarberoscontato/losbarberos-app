create or replace function public.cancel_customer_subscription(
  p_organization_id uuid,
  p_subscription_id uuid,
  p_reason text default 'Cancelamento solicitado'
)
returns public.customer_subscriptions
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_sub public.customer_subscriptions%rowtype; v_cycle_end date; v_is_owner boolean;
begin
  select * into strict v_sub from public.customer_subscriptions where id=p_subscription_id and organization_id=p_organization_id for update;
  v_is_owner := public.is_organization_owner(p_organization_id);
  if not v_is_owner and not public.is_organization_customer(p_organization_id,v_sub.customer_id) then raise exception using errcode='42501', message='subscription cancellation denied'; end if;
  if v_sub.status in ('CANCELED','EXPIRED') then return v_sub; end if;
  select max(ends_on) into v_cycle_end from public.customer_subscription_cycles where subscription_id=v_sub.id and status in ('PAID','OPEN','OVERDUE') and starts_on <= current_date;
  update public.customer_subscription_cycles set status='CANCELED',canceled_at=now() where subscription_id=v_sub.id and starts_on > current_date and status in ('OPEN','OVERDUE');
  update public.customer_subscription_sessions set status='CANCELED',canceled_at=now() where subscription_id=v_sub.id and status='AVAILABLE' and cycle_id in (select id from public.customer_subscription_cycles where subscription_id=v_sub.id and status='CANCELED');
  update public.customer_subscriptions set status='CANCELED',cancellation_requested_at=now(),cancellation_effective_date=coalesce(v_cycle_end,current_date),cancellation_reason=left(btrim(coalesce(p_reason,'Cancelamento solicitado')),500),updated_at=now() where id=v_sub.id returning * into v_sub;
  insert into public.subscription_events(organization_id,subscription_id,event_type,actor_user_id,idempotency_key,metadata) values(p_organization_id,v_sub.id,'CANCELED',auth.uid(),'canceled:'||v_sub.id||':'||to_char(now(),'YYYYMMDDHH24MISSUS'),jsonb_build_object('effective_date',v_sub.cancellation_effective_date,'manual_refund_required',v_sub.upfront_payment));
  return v_sub;
end $$;

revoke all on function public.cancel_customer_subscription(uuid,uuid,text) from public, anon;
grant execute on function public.cancel_customer_subscription(uuid,uuid,text) to authenticated;
