-- Use a character class for '+' and digits. It avoids the escaped-regex
-- corruption that rejected valid E.164 numbers in the first migration.
alter table public.whatsapp_automation_settings_v2
  drop constraint if exists whatsapp_automation_settings_manager_notification_phone_e_check;
alter table public.whatsapp_automation_settings_v2
  add constraint whatsapp_automation_settings_manager_notification_phone_e_check
  check (manager_notification_phone_e164 is null or manager_notification_phone_e164 ~ '^[+][1-9][0-9]{7,14}$');

create or replace function public.save_whatsapp_v2_manager_notification_phone(
  p_organization_id uuid,
  p_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_input text := btrim(coalesce(p_phone, ''));
  v_digits text;
  v_phone text;
  v_matches_qr boolean;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'not organization owner';
  end if;

  if v_input = '' then
    v_phone := null;
  else
    v_digits := regexp_replace(v_input, '[^0-9]', '', 'g');
    if char_length(v_digits) < 8 or char_length(v_digits) > 15 then
      raise exception using errcode = '22023', message = 'invalid manager notification phone';
    end if;
    if left(v_input, 1) = '+' or (left(v_digits, 2) = '55' and char_length(v_digits) >= 12) then
      v_phone := '+' || v_digits;
    else
      v_phone := '+55' || v_digits;
    end if;
    if v_phone !~ '^[+][1-9][0-9]{7,14}$' then
      raise exception using errcode = '22023', message = 'invalid manager notification phone';
    end if;
  end if;

  insert into public.whatsapp_automation_settings_v2 (organization_id, manager_notification_phone_e164)
  values (p_organization_id, v_phone)
  on conflict (organization_id) do update
    set manager_notification_phone_e164 = excluded.manager_notification_phone_e164,
        updated_at = now();

  select v_phone is not null and exists (
    select 1 from public.whatsapp_business_connections c
    where c.organization_id = p_organization_id
      and c.provider = 'QR_WEB'
      and c.is_active
      and c.connected_phone_e164 is not null
      and public.whatsapp_v2_phone_matches(c.connected_phone_e164, v_phone)
  ) into v_matches_qr;

  return jsonb_build_object('phone_e164', v_phone, 'matches_qr_phone', coalesce(v_matches_qr, false));
end;
$$;

revoke all on function public.save_whatsapp_v2_manager_notification_phone(uuid, text) from public, anon;
grant execute on function public.save_whatsapp_v2_manager_notification_phone(uuid, text) to authenticated;
notify pgrst, 'reload schema';
