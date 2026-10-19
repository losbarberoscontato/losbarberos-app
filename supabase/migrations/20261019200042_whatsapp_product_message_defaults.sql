-- Keep one WhatsApp runtime and select default copy from the tenant's assigned product.
-- Only values equal to the former shared defaults are replaced; manager-written copy survives.

create or replace function public.whatsapp_v2_legacy_default_message_templates()
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'BOOKING_CREATED_CLIENT', '{cliente}, seu agendamento foi confirmado para {horario}.',
    'BOOKING_CREATED_STAFF', 'Novo agendamento: {cliente}, {horario}.',
    'REMINDER_T24_CLIENT', E'Lembrete: seu atendimento está marcado para {horario} (daqui a 24 horas).\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente',
    'REMINDER_MORNING_CLIENT', E'Lembrete: seu atendimento é {horario}.\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente',
    'REMINDER_T180_CLIENT', E'Lembrete: seu atendimento está marcado para {horario}.\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente',
    'REMINDER_T45_CLIENT', E'Lembrete: seu atendimento está marcado para {horario}.\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente',
    'CONFIRMATION_ACK_CLIENT', 'Presença confirmada. Até {horario}.',
    'CANCELLATION_ACK_CLIENT', 'Cancelamento confirmado. Se precisar, fale com o estabelecimento para novo horário.',
    'APPOINTMENT_CONFIRMED_STAFF', '{cliente} confirmou presença pelo WhatsApp para {horario}.',
    'APPOINTMENT_CANCELED_STAFF', '{cliente} cancelou pelo WhatsApp.',
    'INVALID_REPLY_PROMPT', E'Não entendi sua resposta.\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente',
    'ATTENDANT_REQUEST_MANAGER', E'Cliente deseja falar com atendente.\n\nCliente: {cliente}\nWhatsApp: {telefone}\nData e hora: {horario}\nProfissional: {barbeiro}\nServiço: {servico}',
    'MANUAL_CONFIRMATION_CLIENT', '{cliente}, seu agendamento foi confirmado pelo estabelecimento para {horario}.',
    'MANUAL_CONFIRMATION_STAFF', 'Agendamento confirmado manualmente: {cliente}, {horario}.',
    'RESERVATION_CHOICE', E'Encontrei mais de um agendamento. Responda com o número correspondente:\n\n{reservas}'
  );
$$;

create or replace function public.whatsapp_v2_default_message_templates()
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'BOOKING_CREATED_CLIENT', '{cliente}, seu agendamento foi confirmado para {horario}.',
    'BOOKING_CREATED_STAFF', 'Novo agendamento: {cliente}, {horario}.',
    'REMINDER_T24_CLIENT', E'Lembrete: seu atendimento está marcado para {horario} (daqui a 24 horas).\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente',
    'REMINDER_MORNING_CLIENT', E'Lembrete: seu atendimento é {horario}.\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente',
    'REMINDER_T180_CLIENT', E'Lembrete: seu atendimento está marcado para {horario}.\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente',
    'REMINDER_T45_CLIENT', E'Lembrete: seu atendimento está marcado para {horario}.\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente',
    'CONFIRMATION_ACK_CLIENT', 'Presença confirmada. Até {horario}.',
    'CANCELLATION_ACK_CLIENT', 'Cancelamento confirmado. Se precisar, fale com o estabelecimento para novo horário.',
    'APPOINTMENT_CONFIRMED_STAFF', '{cliente} confirmou presença pelo WhatsApp para {horario}.',
    'APPOINTMENT_CANCELED_STAFF', '{cliente} cancelou pelo WhatsApp.',
    'INVALID_REPLY_PROMPT', E'Não entendi sua resposta.\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente',
    'ATTENDANT_REQUEST_MANAGER', E'Cliente deseja falar com atendente.\n\nCliente: {cliente}\nWhatsApp: {telefone}\nData e hora: {horario}\nProfissional: {profissional}\nServiço: {servico}',
    'MANUAL_CONFIRMATION_CLIENT', '{cliente}, seu agendamento foi confirmado pelo estabelecimento para {horario}.',
    'MANUAL_CONFIRMATION_STAFF', 'Agendamento confirmado manualmente: {cliente}, {horario}.',
    'RESERVATION_CHOICE', E'Encontrei mais de um agendamento. Responda com o número correspondente:\n\n{reservas}'
  );
$$;

revoke all on function public.whatsapp_v2_legacy_default_message_templates() from public, anon, authenticated;
revoke all on function public.whatsapp_v2_default_message_templates() from public, anon, authenticated;
grant execute on function public.whatsapp_v2_default_message_templates() to service_role;

create or replace function public.whatsapp_v2_default_message_templates_for_product(p_product_key text)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_templates jsonb := public.whatsapp_v2_default_message_templates();
  v_confirmation text := E'Responda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente';
begin
  if p_product_key is null or p_product_key not in ('los-barberos', 'le-gras', 'pro-stetic', 'music-pro') then
    raise exception using errcode = '22023', message = 'unsupported Display product';
  end if;

  if p_product_key = 'los-barberos' then
    return v_templates || jsonb_build_object(
      'BOOKING_CREATED_CLIENT', '{cliente}, seu agendamento na barbearia foi confirmado para {horario}.',
      'BOOKING_CREATED_STAFF', 'Novo agendamento na barbearia: {cliente}, {horario}.',
      'REMINDER_T24_CLIENT', E'Lembrete: seu atendimento está marcado para {horario} (daqui a 24 horas).\n\n' || v_confirmation,
      'REMINDER_MORNING_CLIENT', E'Lembrete: seu atendimento é {horario}.\n\n' || v_confirmation,
      'REMINDER_T180_CLIENT', E'Lembrete: seu atendimento está marcado para {horario}.\n\n' || v_confirmation,
      'REMINDER_T45_CLIENT', E'Lembrete: seu atendimento está marcado para {horario}.\n\n' || v_confirmation,
      'CANCELLATION_ACK_CLIENT', 'Cancelamento confirmado. Se precisar, fale com a barbearia para marcar novo horário.',
      'ATTENDANT_REQUEST_MANAGER', E'Cliente deseja falar com atendente.\n\nCliente: {cliente}\nWhatsApp: {telefone}\nData e hora: {horario}\nBarbeiro: {profissional}\nServiço: {servico}',
      'MANUAL_CONFIRMATION_CLIENT', '{cliente}, seu agendamento foi confirmado pela barbearia para {horario}.'
    );
  elsif p_product_key = 'le-gras' then
    return v_templates || jsonb_build_object(
      'BOOKING_CREATED_CLIENT', '{cliente}, sua sessão fotográfica no estúdio foi confirmada para {horario}.',
      'BOOKING_CREATED_STAFF', 'Nova sessão fotográfica: {cliente}, {horario}.',
      'REMINDER_T24_CLIENT', E'Lembrete: sua sessão fotográfica está marcada para {horario} (daqui a 24 horas).\n\n' || v_confirmation,
      'REMINDER_MORNING_CLIENT', E'Lembrete: sua sessão fotográfica é {horario}.\n\n' || v_confirmation,
      'REMINDER_T180_CLIENT', E'Lembrete: sua sessão fotográfica está marcada para {horario}.\n\n' || v_confirmation,
      'REMINDER_T45_CLIENT', E'Lembrete: sua sessão fotográfica está marcada para {horario}.\n\n' || v_confirmation,
      'CONFIRMATION_ACK_CLIENT', 'Presença na sessão confirmada. Até {horario}.',
      'CANCELLATION_ACK_CLIENT', 'Cancelamento confirmado. Se precisar, fale com o estúdio para marcar novo horário.',
      'APPOINTMENT_CONFIRMED_STAFF', '{cliente} confirmou presença na sessão pelo WhatsApp para {horario}.',
      'APPOINTMENT_CANCELED_STAFF', '{cliente} cancelou a sessão pelo WhatsApp.',
      'ATTENDANT_REQUEST_MANAGER', E'Cliente deseja falar com atendente.\n\nCliente: {cliente}\nWhatsApp: {telefone}\nData e hora: {horario}\nFotógrafo: {profissional}\nSessão fotográfica: {servico}',
      'MANUAL_CONFIRMATION_CLIENT', '{cliente}, sua sessão fotográfica foi confirmada pelo estúdio para {horario}.',
      'MANUAL_CONFIRMATION_STAFF', 'Sessão fotográfica confirmada manualmente: {cliente}, {horario}.',
      'RESERVATION_CHOICE', E'Encontrei mais de uma sessão. Responda com o número correspondente:\n\n{reservas}'
    );
  elsif p_product_key = 'pro-stetic' then
    return v_templates || jsonb_build_object(
      'BOOKING_CREATED_CLIENT', '{cliente}, seu procedimento na clínica foi confirmado para {horario}.',
      'BOOKING_CREATED_STAFF', 'Novo procedimento na clínica: {cliente}, {horario}.',
      'REMINDER_T24_CLIENT', E'Lembrete: seu procedimento está marcado para {horario} (daqui a 24 horas).\n\n' || v_confirmation,
      'REMINDER_MORNING_CLIENT', E'Lembrete: seu procedimento é {horario}.\n\n' || v_confirmation,
      'REMINDER_T180_CLIENT', E'Lembrete: seu procedimento está marcado para {horario}.\n\n' || v_confirmation,
      'REMINDER_T45_CLIENT', E'Lembrete: seu procedimento está marcado para {horario}.\n\n' || v_confirmation,
      'CONFIRMATION_ACK_CLIENT', 'Presença no procedimento confirmada. Até {horario}.',
      'CANCELLATION_ACK_CLIENT', 'Cancelamento confirmado. Se precisar, fale com a clínica para marcar novo horário.',
      'APPOINTMENT_CONFIRMED_STAFF', '{cliente} confirmou presença no procedimento pelo WhatsApp para {horario}.',
      'APPOINTMENT_CANCELED_STAFF', '{cliente} cancelou o procedimento pelo WhatsApp.',
      'ATTENDANT_REQUEST_MANAGER', E'Cliente deseja falar com atendente.\n\nCliente: {cliente}\nWhatsApp: {telefone}\nData e hora: {horario}\nEspecialista: {profissional}\nProcedimento: {servico}',
      'MANUAL_CONFIRMATION_CLIENT', '{cliente}, seu procedimento foi confirmado pela clínica para {horario}.',
      'MANUAL_CONFIRMATION_STAFF', 'Procedimento confirmado manualmente: {cliente}, {horario}.',
      'RESERVATION_CHOICE', E'Encontrei mais de um procedimento. Responda com o número correspondente:\n\n{reservas}'
    );
  else
    return v_templates || jsonb_build_object(
      'BOOKING_CREATED_CLIENT', '{cliente}, sua aula na escola foi confirmada para {horario}.',
      'BOOKING_CREATED_STAFF', 'Nova aula na escola: {cliente}, {horario}.',
      'REMINDER_T24_CLIENT', E'Lembrete: sua aula está marcada para {horario} (daqui a 24 horas).\n\n' || v_confirmation,
      'REMINDER_MORNING_CLIENT', E'Lembrete: sua aula é {horario}.\n\n' || v_confirmation,
      'REMINDER_T180_CLIENT', E'Lembrete: sua aula está marcada para {horario}.\n\n' || v_confirmation,
      'REMINDER_T45_CLIENT', E'Lembrete: sua aula está marcada para {horario}.\n\n' || v_confirmation,
      'CONFIRMATION_ACK_CLIENT', 'Presença na aula confirmada. Até {horario}.',
      'CANCELLATION_ACK_CLIENT', 'Cancelamento confirmado. Se precisar, fale com a escola para marcar novo horário.',
      'APPOINTMENT_CONFIRMED_STAFF', '{cliente} confirmou presença na aula pelo WhatsApp para {horario}.',
      'APPOINTMENT_CANCELED_STAFF', '{cliente} cancelou a aula pelo WhatsApp.',
      'INVALID_REPLY_PROMPT', E'Não entendi sua resposta.\n\n' || v_confirmation,
      'ATTENDANT_REQUEST_MANAGER', E'Aluno deseja falar com atendente.\n\nAluno: {cliente}\nWhatsApp: {telefone}\nData e hora: {horario}\nProfessor: {profissional}\nAula: {servico}',
      'MANUAL_CONFIRMATION_CLIENT', '{cliente}, sua aula foi confirmada pela escola para {horario}.',
      'MANUAL_CONFIRMATION_STAFF', 'Aula confirmada manualmente: {cliente}, {horario}.',
      'RESERVATION_CHOICE', E'Encontrei mais de uma aula. Responda com o número correspondente:\n\n{reservas}'
    );
  end if;
end;
$$;

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
      or v_templates ->> v_entry.key = v_shared ->> v_entry.key then
      v_templates := jsonb_set(v_templates, array[v_entry.key], v_entry.value, true);
    end if;
  end loop;
  return v_templates;
end;
$$;

revoke all on function public.whatsapp_v2_default_message_templates_for_product(text) from public, anon, authenticated;
revoke all on function public.whatsapp_v2_localize_message_templates_for_product(text, jsonb) from public, anon, authenticated;
revoke all on function public.whatsapp_v2_legacy_default_message_templates() from service_role;
grant execute on function public.whatsapp_v2_default_message_templates_for_product(text) to service_role;
grant execute on function public.whatsapp_v2_localize_message_templates_for_product(text, jsonb) to service_role;

update public.whatsapp_automation_settings_v2 s
set templates = public.whatsapp_v2_localize_message_templates_for_product(a.product_key, s.templates)
from public.organization_product_assignments a
where a.organization_id = s.organization_id
  and s.templates is distinct from public.whatsapp_v2_localize_message_templates_for_product(a.product_key, s.templates);

create or replace function public.whatsapp_v2_apply_product_message_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_product_key text;
begin
  select a.product_key into v_product_key
  from public.organization_product_assignments a
  where a.organization_id = new.organization_id;
  if v_product_key is null then
    return new;
  end if;
  new.templates := public.whatsapp_v2_localize_message_templates_for_product(v_product_key, new.templates);
  return new;
end;
$$;

revoke all on function public.whatsapp_v2_apply_product_message_defaults() from public, anon, authenticated;

drop trigger if exists whatsapp_v2_product_message_defaults on public.whatsapp_automation_settings_v2;
create trigger whatsapp_v2_product_message_defaults
before insert or update of templates on public.whatsapp_automation_settings_v2
for each row execute function public.whatsapp_v2_apply_product_message_defaults();

create or replace function public.whatsapp_v2_localize_settings_after_product_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.whatsapp_automation_settings_v2 s
  set templates = public.whatsapp_v2_localize_message_templates_for_product(new.product_key, s.templates)
  where s.organization_id = new.organization_id;
  return new;
end;
$$;

revoke all on function public.whatsapp_v2_localize_settings_after_product_assignment() from public, anon, authenticated;

drop trigger if exists whatsapp_v2_product_assignment_message_defaults on public.organization_product_assignments;
create trigger whatsapp_v2_product_assignment_message_defaults
after insert or update of product_key on public.organization_product_assignments
for each row execute function public.whatsapp_v2_localize_settings_after_product_assignment();
