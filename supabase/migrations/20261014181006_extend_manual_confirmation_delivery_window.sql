-- Manual confirmation can be requested during the scheduled service window.
-- Do not expire it at appointment start; still suppress delivery after service end.
create or replace function public.set_manual_confirmation_delivery_window()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_service_end timestamptz;
begin
  if new.job_type::text <> 'MANUAL_OUTBOUND_TEXT'
    or new.payload ->> 'message_kind' not in ('MANUAL_CONFIRMATION_CLIENT', 'MANUAL_CONFIRMATION_STAFF')
    or new.appointment_id is null then
    return new;
  end if;

  select upper(a.service_period) into v_service_end
  from public.appointments a
  where a.id = new.appointment_id and a.organization_id = new.organization_id;
  if found then
    new.valid_until := v_service_end;
  end if;
  return new;
end;
$$;

drop trigger if exists whatsapp_manual_confirmation_delivery_window on public.whatsapp_automation_jobs;
create trigger whatsapp_manual_confirmation_delivery_window
before insert on public.whatsapp_automation_jobs
for each row execute function public.set_manual_confirmation_delivery_window();
