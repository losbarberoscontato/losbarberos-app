-- Corrige o nome da função na mensagem padrão antiga sem alterar outras
-- escolhas de formatação eventualmente feitas pela organização.
update public.whatsapp_automation_settings_v2 s
set templates = jsonb_set(
  s.templates,
  '{ATTENDANT_REQUEST_MANAGER}',
  to_jsonb(replace(s.templates->>'ATTENDANT_REQUEST_MANAGER', 'Fotógrafo:', 'Profissional:')),
  false
)
from public.organization_product_assignments a
where a.organization_id = s.organization_id
  and a.product_key = 'le-gras'
  and jsonb_typeof(s.templates->'ATTENDANT_REQUEST_MANAGER') = 'string'
  and s.templates->>'ATTENDANT_REQUEST_MANAGER' like '%Fotógrafo:%';
