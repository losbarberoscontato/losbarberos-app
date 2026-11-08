-- Preserve the existing automation validation while persisting the two
-- contract templates configured in the WhatsApp settings UI.
alter function public.save_whatsapp_v2_automation_controls(uuid, jsonb, jsonb)
  rename to save_whatsapp_v2_automation_controls_before_contract_templates;

create or replace function public.save_whatsapp_v2_automation_controls(
  p_organization_id uuid,
  p_rules jsonb,
  p_custom_messages jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rules jsonb := p_rules;
  v_input_templates jsonb;
  v_contract_templates jsonb := '{}'::jsonb;
  v_result jsonb;
begin
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501', message = 'not organization owner';
  end if;

  if jsonb_typeof(p_rules) = 'object' then
    v_input_templates := coalesce(p_rules -> 'message_templates', '{}'::jsonb);
    if jsonb_typeof(v_input_templates) = 'object' then
      v_contract_templates := jsonb_strip_nulls(jsonb_build_object(
          'PROJECT_CONTRACT_CREATED_CLIENT', v_input_templates -> 'PROJECT_CONTRACT_CREATED_CLIENT',
          'SUBSCRIPTION_CREATED_CLIENT', v_input_templates -> 'SUBSCRIPTION_CREATED_CLIENT'
        ));
      if exists (
        select 1 from jsonb_each(v_contract_templates) entry
        where jsonb_typeof(entry.value) <> 'string'
          or char_length(btrim(entry.value #>> '{}')) = 0
          or char_length(entry.value #>> '{}') > 4096
      ) then
        raise exception using errcode = '22023', message = 'invalid message templates';
      end if;
      v_rules := jsonb_set(
        p_rules,
        '{message_templates}',
        v_input_templates - array['PROJECT_CONTRACT_CREATED_CLIENT', 'SUBSCRIPTION_CREATED_CLIENT'],
        true
      );
    end if;
  end if;

  v_result := public.save_whatsapp_v2_automation_controls_before_contract_templates(
    p_organization_id, v_rules, p_custom_messages
  );

  if v_contract_templates <> '{}'::jsonb then
    update public.whatsapp_automation_settings_v2
    set templates = templates || v_contract_templates,
        updated_at = now()
    where organization_id = p_organization_id;
  end if;

  return v_result;
end;
$$;

revoke all on function public.save_whatsapp_v2_automation_controls(uuid, jsonb, jsonb) from public, anon, service_role;
grant execute on function public.save_whatsapp_v2_automation_controls(uuid, jsonb, jsonb) to authenticated;
notify pgrst, 'reload schema';
