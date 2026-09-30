-- Publish the ProStetic vocabulary and keep its editable identity draft aligned.
update public.platform_product_identities as identity
set config = jsonb_set(
  identity.config,
  '{vocabulary}',
  coalesce(identity.config->'vocabulary', '{}'::jsonb) ||
    '{"organization":"estúdio","organizationPlural":"estúdios","professional":"especialista","professionalPlural":"especialistas","teamApp":"App da Equipe","organizationPicker":"Meus estúdios","customer":"cliente","customerPlural":"clientes","service":"serviço","servicePlural":"serviços"}'::jsonb,
  true
),
revision = identity.revision + 1,
published_at = now()
where identity.product_key = 'pro-stetic';

update public.platform_product_identity_drafts as draft
set config = jsonb_set(
  draft.config,
  '{vocabulary}',
  coalesce(draft.config->'vocabulary', '{}'::jsonb) ||
    '{"organization":"estúdio","organizationPlural":"estúdios","professional":"especialista","professionalPlural":"especialistas","teamApp":"App da Equipe","organizationPicker":"Meus estúdios","customer":"cliente","customerPlural":"clientes","service":"serviço","servicePlural":"serviços"}'::jsonb,
  true
),
updated_at = now()
where draft.product_key = 'pro-stetic';
