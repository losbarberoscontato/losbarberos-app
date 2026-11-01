create or replace function public.whatsapp_v2_default_message_templates_for_product(p_product_key text)
returns jsonb language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v_templates jsonb := public.whatsapp_v2_default_message_templates_for_product_before_auxiliaries(p_product_key);
  v_subject text;
  v_preposition text;
  v_article text;
begin
  case p_product_key
    when 'los-barberos' then v_subject := 'atendimento'; v_preposition := 'no'; v_article := 'o';
    when 'le-gras' then v_subject := 'sessão'; v_preposition := 'na'; v_article := 'a';
    when 'pro-stetic' then v_subject := 'atendimento'; v_preposition := 'no'; v_article := 'o';
    when 'music-pro' then v_subject := 'aula'; v_preposition := 'na'; v_article := 'a';
    else raise exception using errcode = '22023', message = 'unsupported Display product';
  end case;
  return v_templates || jsonb_build_object(
    'BOOKING_CREATED_AUXILIARY', 'Você foi escalado como auxiliar ' || v_preposition || ' ' || v_subject || ' de {cliente} em {horario}.',
    'APPOINTMENT_CONFIRMED_AUXILIARY', '{cliente} confirmou presença ' || v_preposition || ' ' || v_subject || ' em {horario}. Você está escalado como auxiliar.',
    'APPOINTMENT_CANCELED_AUXILIARY', '{cliente} cancelou ' || v_article || ' ' || v_subject || '.',
    'MANUAL_CONFIRMATION_AUXILIARY', 'O gestor confirmou manualmente ' || v_article || ' ' || v_subject || ' de {cliente} em {horario}. Você está escalado como auxiliar.'
  );
end;
$$;

-- Correct old defaults only; preserve any text edited by a manager.
update public.whatsapp_automation_settings_v2 s
set templates = s.templates || jsonb_build_object(
  'APPOINTMENT_CONFIRMED_AUXILIARY',
    case when a.product_key = 'le-gras'
        and s.templates ->> 'APPOINTMENT_CONFIRMED_AUXILIARY' = '{cliente} confirmou presença no sessão em {horario}. Você está escalado como auxiliar.'
      then public.whatsapp_v2_default_message_templates_for_product(a.product_key) -> 'APPOINTMENT_CONFIRMED_AUXILIARY'
      when a.product_key = 'music-pro'
        and s.templates ->> 'APPOINTMENT_CONFIRMED_AUXILIARY' = '{cliente} confirmou presença no aula em {horario}. Você está escalado como auxiliar.'
      then public.whatsapp_v2_default_message_templates_for_product(a.product_key) -> 'APPOINTMENT_CONFIRMED_AUXILIARY'
      else s.templates -> 'APPOINTMENT_CONFIRMED_AUXILIARY' end,
  'APPOINTMENT_CANCELED_AUXILIARY',
    case when a.product_key = 'le-gras'
        and s.templates ->> 'APPOINTMENT_CANCELED_AUXILIARY' = '{cliente} cancelou o sessão.'
      then public.whatsapp_v2_default_message_templates_for_product(a.product_key) -> 'APPOINTMENT_CANCELED_AUXILIARY'
      when a.product_key = 'music-pro'
        and s.templates ->> 'APPOINTMENT_CANCELED_AUXILIARY' = '{cliente} cancelou o aula.'
      then public.whatsapp_v2_default_message_templates_for_product(a.product_key) -> 'APPOINTMENT_CANCELED_AUXILIARY'
      else s.templates -> 'APPOINTMENT_CANCELED_AUXILIARY' end,
  'MANUAL_CONFIRMATION_AUXILIARY',
    case when a.product_key = 'le-gras'
        and s.templates ->> 'MANUAL_CONFIRMATION_AUXILIARY' = 'O gestor confirmou manualmente o sessão de {cliente} em {horario}. Você está escalado como auxiliar.'
      then public.whatsapp_v2_default_message_templates_for_product(a.product_key) -> 'MANUAL_CONFIRMATION_AUXILIARY'
      when a.product_key = 'music-pro'
        and s.templates ->> 'MANUAL_CONFIRMATION_AUXILIARY' = 'O gestor confirmou manualmente o aula de {cliente} em {horario}. Você está escalado como auxiliar.'
      then public.whatsapp_v2_default_message_templates_for_product(a.product_key) -> 'MANUAL_CONFIRMATION_AUXILIARY'
      else s.templates -> 'MANUAL_CONFIRMATION_AUXILIARY' end
)
from public.organization_product_assignments a
where a.organization_id = s.organization_id
  and a.product_key in ('le-gras', 'music-pro')
  and (
    s.templates ->> 'APPOINTMENT_CONFIRMED_AUXILIARY' in (
      '{cliente} confirmou presença no sessão em {horario}. Você está escalado como auxiliar.',
      '{cliente} confirmou presença no aula em {horario}. Você está escalado como auxiliar.'
    )
    or s.templates ->> 'APPOINTMENT_CANCELED_AUXILIARY' in (
      '{cliente} cancelou o sessão.',
      '{cliente} cancelou o aula.'
    )
    or s.templates ->> 'MANUAL_CONFIRMATION_AUXILIARY' in (
      'O gestor confirmou manualmente o sessão de {cliente} em {horario}. Você está escalado como auxiliar.',
      'O gestor confirmou manualmente o aula de {cliente} em {horario}. Você está escalado como auxiliar.'
    )
  );

revoke all on function public.whatsapp_v2_default_message_templates_for_product(text) from public, anon, authenticated;
grant execute on function public.whatsapp_v2_default_message_templates_for_product(text) to service_role;
