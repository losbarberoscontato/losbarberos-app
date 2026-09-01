-- Fix the commission field name used by the final appointment amount adjustment.
create or replace function public.sync_appointment_commission_to_final_amount(
  p_appointment_id uuid,
  p_final_total_cents bigint,
  p_adjustment_key text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_appointment public.appointments%rowtype;
  v_list_total bigint;
  v_desired bigint;
  v_current bigint;
  v_delta bigint;
  v_entry record;
begin
  select * into strict v_appointment
  from public.appointments
  where id = p_appointment_id
  for update;

  select coalesce(sum(i.list_price_cents_snapshot * i.quantity), 0)::bigint
    into v_list_total
  from public.appointment_items i
  where i.organization_id = v_appointment.organization_id
    and i.appointment_id = v_appointment.id;

  if v_list_total <= 0 then
    return;
  end if;

  for v_entry in
    select
      cl.id as source_entry_id,
      cl.amount_cents as earned_cents,
      i.list_price_cents_snapshot,
      i.quantity,
      i.commission_mode_snapshot,
      i.commission_percentage_bps_snapshot
    from public.commission_ledger cl
    join public.appointment_items i
      on i.organization_id = cl.organization_id
     and i.id = cl.appointment_item_id
    where cl.organization_id = v_appointment.organization_id
      and cl.appointment_id = v_appointment.id
      and cl.kind = 'EARNED'
      and cl.source_entry_id is null
    order by i.position, cl.id
  loop
    if v_entry.commission_mode_snapshot = 'PERCENT' then
      v_desired := round(
        p_final_total_cents::numeric
          * (v_entry.list_price_cents_snapshot * v_entry.quantity)::numeric
          / v_list_total
          * v_entry.commission_percentage_bps_snapshot / 10000
      )::bigint;
    else
      v_desired := v_entry.earned_cents;
    end if;

    select v_entry.earned_cents + coalesce(sum(cl.amount_cents), 0)::bigint
      into v_current
    from public.commission_ledger cl
    where cl.source_entry_id = v_entry.source_entry_id;

    v_delta := v_desired - v_current;
    if v_delta <> 0 then
      perform public.adjust_commission_entry(
        v_entry.source_entry_id,
        'ADJUSTMENT',
        v_delta,
        p_reason,
        'appointment-final-amount:' || p_adjustment_key || ':' || v_entry.source_entry_id
      );
    end if;
  end loop;
end;
$$;
