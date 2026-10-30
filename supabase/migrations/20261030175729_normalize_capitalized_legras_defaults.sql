-- Os valores legados de Le Gras foram gravados com inicial maiúscula.
-- Atualiza somente termos padrão reconhecidos, mantendo personalizações.
update public.platform_product_identities
set config = jsonb_set(
  config,
  '{vocabulary}',
  coalesce(config->'vocabulary', '{}'::jsonb) || jsonb_build_object(
    'professional', case when lower(config#>>'{vocabulary,professional}') = 'fotógrafo' then 'profissional de fotografia' else config#>>'{vocabulary,professional}' end,
    'professionalPlural', case when lower(config#>>'{vocabulary,professionalPlural}') = 'fotógrafos' then 'profissionais de fotografia' else config#>>'{vocabulary,professionalPlural}' end,
    'teamApp', case when lower(config#>>'{vocabulary,teamApp}') = 'app da equipe' then 'App da equipe' else config#>>'{vocabulary,teamApp}' end,
    'service', case when config#>>'{vocabulary,service}' is null or lower(config#>>'{vocabulary,service}') = 'serviço' then 'sessão fotográfica' else config#>>'{vocabulary,service}' end,
    'servicePlural', case when config#>>'{vocabulary,servicePlural}' is null or lower(config#>>'{vocabulary,servicePlural}') = 'serviços' then 'sessões fotográficas' else config#>>'{vocabulary,servicePlural}' end
  ),
  true
)
where product_key = 'le-gras'
  and (lower(config#>>'{vocabulary,professional}') = 'fotógrafo'
    or lower(config#>>'{vocabulary,professionalPlural}') = 'fotógrafos'
    or lower(config#>>'{vocabulary,teamApp}') = 'app da equipe'
    or config#>>'{vocabulary,service}' is null
    or config#>>'{vocabulary,servicePlural}' is null);

update public.platform_product_identity_drafts
set config = jsonb_set(
  config,
  '{vocabulary}',
  coalesce(config->'vocabulary', '{}'::jsonb) || jsonb_build_object(
    'professional', case when lower(config#>>'{vocabulary,professional}') = 'fotógrafo' then 'profissional de fotografia' else config#>>'{vocabulary,professional}' end,
    'professionalPlural', case when lower(config#>>'{vocabulary,professionalPlural}') = 'fotógrafos' then 'profissionais de fotografia' else config#>>'{vocabulary,professionalPlural}' end,
    'teamApp', case when lower(config#>>'{vocabulary,teamApp}') = 'app da equipe' then 'App da equipe' else config#>>'{vocabulary,teamApp}' end,
    'service', case when config#>>'{vocabulary,service}' is null or lower(config#>>'{vocabulary,service}') = 'serviço' then 'sessão fotográfica' else config#>>'{vocabulary,service}' end,
    'servicePlural', case when config#>>'{vocabulary,servicePlural}' is null or lower(config#>>'{vocabulary,servicePlural}') = 'serviços' then 'sessões fotográficas' else config#>>'{vocabulary,servicePlural}' end
  ),
  true
)
where product_key = 'le-gras'
  and (lower(config#>>'{vocabulary,professional}') = 'fotógrafo'
    or lower(config#>>'{vocabulary,professionalPlural}') = 'fotógrafos'
    or lower(config#>>'{vocabulary,teamApp}') = 'app da equipe'
    or config#>>'{vocabulary,service}' is null
    or config#>>'{vocabulary,servicePlural}' is null);
