create or replace function public.cancel_financial_entry(p_entry_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_entry public.financial_entries%rowtype; v_settlement public.financial_settlements%rowtype; v_remaining bigint;
begin
  select * into strict v_entry from public.financial_entries where id = p_entry_id for update;
  perform public.require_financial_owner(v_entry.organization_id, 'financial entry cancellation');
  if nullif(btrim(p_reason), '') is null then raise exception using errcode = '22023', message = 'cancellation reason is required'; end if;
  if v_entry.canceled_at is not null then return; end if;
  if v_entry.source = 'MANUAL' then
    for v_settlement in select * from public.financial_settlements where organization_id = v_entry.organization_id and entry_id = v_entry.id and kind = 'SETTLEMENT' order by settled_on, created_at loop
      select greatest(v_settlement.amount_cents - coalesce(sum(r.amount_cents), 0), 0)::bigint into v_remaining from public.financial_settlements r where r.source_settlement_id = v_settlement.id and r.kind = 'REVERSAL';
      if v_remaining > 0 then
        perform public.reverse_financial_settlement(v_settlement.id, v_remaining, left(btrim(p_reason), 500), 'manager:cancel-manual:' || v_entry.id || ':' || v_settlement.id);
      end if;
    end loop;
  elsif exists (select 1 from public.financial_settlements where entry_id = v_entry.id) then
    raise exception using errcode = '22023', message = 'settled financial entry requires reversal';
  end if;
  update public.financial_entries set canceled_at = now(), cancellation_reason = left(btrim(p_reason), 500) where id = v_entry.id;
exception when no_data_found then raise exception using errcode = 'P0002', message = 'financial entry not found'; end; $$;
