-- Atualiza apenas a terminologia padrão dos produtos. Valores personalizados por
-- uma organização permanecem preservados.

create or replace function public.display_grammar_product_vocabulary(
  p_product_key text,
  p_vocabulary jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v jsonb := case when jsonb_typeof(p_vocabulary) = 'object' then p_vocabulary else '{}'::jsonb end;
begin
  if p_product_key = 'le-gras' then
    if v->>'professional' = 'fotógrafo' then v := jsonb_set(v, '{professional}', '"profissional de fotografia"'); end if;
    if v->>'professionalPlural' = 'fotógrafos' then v := jsonb_set(v, '{professionalPlural}', '"profissionais de fotografia"'); end if;
    if v->>'teamApp' = 'App da Equipe' then v := jsonb_set(v, '{teamApp}', '"App da equipe"'); end if;
    v := v || jsonb_build_object('service', coalesce(v->>'service', 'sessão fotográfica'), 'servicePlural', coalesce(v->>'servicePlural', 'sessões fotográficas'));
  elsif p_product_key = 'pro-stetic' then
    if v->>'organization' = 'clínica' then v := jsonb_set(v, '{organization}', '"estúdio"'); end if;
    if v->>'organizationPlural' = 'clínicas' then v := jsonb_set(v, '{organizationPlural}', '"estúdios"'); end if;
    if v->>'organizationPicker' = 'Minhas clínicas' then v := jsonb_set(v, '{organizationPicker}', '"Meus estúdios"'); end if;
    if v->>'professional' = 'especialista' or v->>'professional' = 'especialistas' then v := jsonb_set(v, '{professional}', '"profissional"'); end if;
    if v->>'professionalPlural' = 'especialistas' then v := jsonb_set(v, '{professionalPlural}', '"profissionais"'); end if;
  elsif p_product_key = 'music-pro' then
    if v->>'professional' = 'professor' then v := jsonb_set(v, '{professional}', '"professor(a) ou músico(a)"'); end if;
    if v->>'professionalPlural' = 'professores' then v := jsonb_set(v, '{professionalPlural}', '"professores(as) e músicos(as)"'); end if;
    if v->>'teamApp' = 'App do Professor' then v := jsonb_set(v, '{teamApp}', '"App da equipe musical"'); end if;
    if v->>'customer' = 'aluno' then v := jsonb_set(v, '{customer}', '"estudante"'); end if;
    if v->>'customerPlural' = 'alunos' then v := jsonb_set(v, '{customerPlural}', '"estudantes"'); end if;
  end if;
  return v;
end;
$$;

revoke all on function public.display_grammar_product_vocabulary(text, jsonb) from public, anon, authenticated;
grant execute on function public.display_grammar_product_vocabulary(text, jsonb) to service_role;

update public.platform_product_identities
set config = jsonb_set(config, '{vocabulary}', public.display_grammar_product_vocabulary(product_key, config->'vocabulary'), true)
where product_key in ('le-gras', 'pro-stetic', 'music-pro');

update public.platform_product_identity_drafts
set config = jsonb_set(config, '{vocabulary}', public.display_grammar_product_vocabulary(product_key, config->'vocabulary'), true)
where product_key in ('le-gras', 'pro-stetic', 'music-pro');

-- Keep the old implementation callable internally, then expose corrected
-- defaults for new and existing automation settings.
alter function public.whatsapp_v2_default_message_templates_for_product(text)
  rename to whatsapp_v2_legacy_default_message_templates_for_product;

create or replace function public.whatsapp_v2_default_message_templates_for_product(p_product_key text)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_templates jsonb := public.whatsapp_v2_legacy_default_message_templates_for_product(p_product_key);
begin
  if p_product_key = 'le-gras' then
    v_templates := v_templates || jsonb_build_object(
      'ATTENDANT_REQUEST_MANAGER', E'Cliente deseja falar com atendente.\n\nCliente: {cliente}\nWhatsApp: {telefone}\nData e hora: {horario}\nProfissional: {profissional}\nSessão fotográfica: {servico}'
    );
  elsif p_product_key = 'pro-stetic' then
    v_templates := v_templates || jsonb_build_object(
      'BOOKING_CREATED_CLIENT', '{cliente}, seu atendimento no estúdio foi confirmado para {horario}.',
      'BOOKING_CREATED_STAFF', 'Novo atendimento no estúdio: {cliente}, {horario}.',
      'REMINDER_T24_CLIENT', E'Lembrete: seu atendimento está marcado para {horario} (daqui a 24 horas).\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente',
      'REMINDER_MORNING_CLIENT', E'Lembrete: seu atendimento é {horario}.\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente',
      'REMINDER_T180_CLIENT', E'Lembrete: seu atendimento está marcado para {horario}.\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente',
      'REMINDER_T45_CLIENT', E'Lembrete: seu atendimento está marcado para {horario}.\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente',
      'CONFIRMATION_ACK_CLIENT', 'Presença no atendimento confirmada. Até {horario}.',
      'CANCELLATION_ACK_CLIENT', 'Cancelamento confirmado. Se precisar, fale com o estúdio para marcar novo horário.',
      'APPOINTMENT_CONFIRMED_STAFF', '{cliente} confirmou presença no atendimento pelo WhatsApp para {horario}.',
      'APPOINTMENT_CANCELED_STAFF', '{cliente} cancelou o atendimento pelo WhatsApp.',
      'ATTENDANT_REQUEST_MANAGER', E'Cliente deseja falar com atendente.\n\nCliente: {cliente}\nWhatsApp: {telefone}\nData e hora: {horario}\nProfissional: {profissional}\nServiço: {servico}',
      'MANUAL_CONFIRMATION_CLIENT', '{cliente}, seu atendimento foi confirmado pelo estúdio para {horario}.',
      'MANUAL_CONFIRMATION_STAFF', 'Atendimento confirmado manualmente: {cliente}, {horario}.',
      'RESERVATION_CHOICE', E'Encontrei mais de um atendimento. Responda com o número correspondente:\n\n{reservas}'
    );
  elsif p_product_key = 'music-pro' then
    v_templates := v_templates || jsonb_build_object(
      'ATTENDANT_REQUEST_MANAGER', E'Estudante deseja falar com a equipe.\n\nEstudante: {cliente}\nWhatsApp: {telefone}\nData e hora: {horario}\nProfessor(a) ou músico(a): {profissional}\nAula: {servico}'
    );
  end if;
  return v_templates;
end;
$$;

create or replace function public.whatsapp_v2_previous_display_product_templates(p_product_key text)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_product_key
    when 'le-gras' then jsonb_build_object(
      'ATTENDANT_REQUEST_MANAGER', E'Cliente deseja falar com atendente.\n\nCliente: {cliente}\nWhatsApp: {telefone}\nData e hora: {horario}\nFotógrafo: {profissional}\nSessão fotográfica: {servico}'
    )
    when 'pro-stetic' then jsonb_build_object(
      'BOOKING_CREATED_CLIENT', '{cliente}, seu procedimento na clínica foi confirmado para {horario}.',
      'BOOKING_CREATED_STAFF', 'Novo procedimento na clínica: {cliente}, {horario}.',
      'REMINDER_T24_CLIENT', E'Lembrete: seu procedimento está marcado para {horario} (daqui a 24 horas).\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente',
      'REMINDER_MORNING_CLIENT', E'Lembrete: seu procedimento é {horario}.\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente',
      'REMINDER_T180_CLIENT', E'Lembrete: seu procedimento está marcado para {horario}.\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente',
      'REMINDER_T45_CLIENT', E'Lembrete: seu procedimento está marcado para {horario}.\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente',
      'CONFIRMATION_ACK_CLIENT', 'Presença no procedimento confirmada. Até {horario}.',
      'CANCELLATION_ACK_CLIENT', 'Cancelamento confirmado. Se precisar, fale com a clínica para marcar novo horário.',
      'APPOINTMENT_CONFIRMED_STAFF', '{cliente} confirmou presença no procedimento pelo WhatsApp para {horario}.',
      'APPOINTMENT_CANCELED_STAFF', '{cliente} cancelou o procedimento pelo WhatsApp.',
      'ATTENDANT_REQUEST_MANAGER', E'Cliente deseja falar com atendente.\n\nCliente: {cliente}\nWhatsApp: {telefone}\nData e hora: {horario}\nEspecialista: {profissional}\nProcedimento: {servico}',
      'MANUAL_CONFIRMATION_CLIENT', '{cliente}, seu procedimento foi confirmado pela clínica para {horario}.',
      'MANUAL_CONFIRMATION_STAFF', 'Procedimento confirmado manualmente: {cliente}, {horario}.',
      'RESERVATION_CHOICE', E'Encontrei mais de um procedimento. Responda com o número correspondente:\n\n{reservas}'
    )
    when 'music-pro' then jsonb_build_object(
      'ATTENDANT_REQUEST_MANAGER', E'Aluno deseja falar com atendente.\n\nAluno: {cliente}\nWhatsApp: {telefone}\nData e hora: {horario}\nProfessor: {profissional}\nAula: {servico}'
    )
    else '{}'::jsonb
  end;
$$;

revoke all on function public.whatsapp_v2_previous_display_product_templates(text) from public, anon, authenticated;
grant execute on function public.whatsapp_v2_previous_display_product_templates(text) to service_role;

create or replace function public.whatsapp_v2_localize_message_templates_for_product(
  p_product_key text,
  p_templates jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_shared jsonb := public.whatsapp_v2_legacy_default_message_templates();
  v_previous jsonb := public.whatsapp_v2_previous_display_product_templates(p_product_key);
  v_product jsonb := public.whatsapp_v2_default_message_templates_for_product(p_product_key);
  v_templates jsonb := coalesce(p_templates, '{}'::jsonb);
  v_entry record;
begin
  if jsonb_typeof(v_templates) <> 'object' then
    v_templates := '{}'::jsonb;
  end if;
  for v_entry in select key, value from jsonb_each(v_product)
  loop
    if not (v_templates ? v_entry.key)
      or jsonb_typeof(v_templates -> v_entry.key) <> 'string'
      or v_templates ->> v_entry.key = v_shared ->> v_entry.key
      or v_templates ->> v_entry.key = v_previous ->> v_entry.key then
      v_templates := jsonb_set(v_templates, array[v_entry.key], v_entry.value, true);
    end if;
  end loop;
  return v_templates;
end;
$$;

revoke all on function public.whatsapp_v2_default_message_templates_for_product(text) from public, anon, authenticated;
revoke all on function public.whatsapp_v2_legacy_default_message_templates_for_product(text) from public, anon, authenticated;
revoke all on function public.whatsapp_v2_localize_message_templates_for_product(text, jsonb) from public, anon, authenticated;
grant execute on function public.whatsapp_v2_default_message_templates_for_product(text) to service_role;
grant execute on function public.whatsapp_v2_legacy_default_message_templates_for_product(text) to service_role;
grant execute on function public.whatsapp_v2_localize_message_templates_for_product(text, jsonb) to service_role;

update public.whatsapp_automation_settings_v2 s
set templates = public.whatsapp_v2_localize_message_templates_for_product(a.product_key, s.templates)
from public.organization_product_assignments a
where a.organization_id = s.organization_id
  and a.product_key in ('le-gras', 'pro-stetic', 'music-pro')
  and s.templates is distinct from public.whatsapp_v2_localize_message_templates_for_product(a.product_key, s.templates);
