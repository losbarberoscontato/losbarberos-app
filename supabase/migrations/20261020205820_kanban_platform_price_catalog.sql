-- Publish the shared R$ 9.90 monthly Kanban catalog without enabling access.
-- The catalog remains globally inactive until a future, explicitly authorized release.
begin;

do $$
declare
  v_admin uuid;
begin
  select user_id into v_admin from public.platform_admins order by created_at limit 1;
  if v_admin is null then
    raise exception 'Cannot audit Kanban price publication without a platform admin';
  end if;
  if exists (
    select 1 from public.organization_module_entitlements
    where module_key = 'kanban' and enabled
  ) then
    raise exception 'Kanban already has enabled organizations; refusing price-only publication';
  end if;
  if exists (
    select 1 from public.platform_kanban_price_versions where retired_at is null
  ) then
    raise exception 'Current Kanban prices already exist; refusing to replace the catalog';
  end if;

  insert into public.platform_kanban_price_versions (
    product_key,
    monthly_price_cents,
    stripe_test_price_id,
    stripe_live_price_id,
    contract_version,
    contract_body,
    created_by
  ) values
    (
      'los-barberos', 990,
      'price_1USjWN0StL37D8g9PCFtAWTx',
      'price_1USjW90StL37D8g91nGT31vM',
      'kanban-2026-10-v1',
      'A ativação do módulo libera o acesso imediatamente. A mensalidade de R$ 9,90 começa a ser cobrada no próximo ciclo da assinatura da organização, sem cobrança proporcional, inclusive após o período de teste. A desativação remove o item recorrente sem crédito proporcional. Os quadros, cards e histórico permanecem armazenados; o módulo fica oculto enquanto inativo. O novo preço vale apenas para novas ativações; o preço aceito permanece nas ativações existentes.',
      v_admin
    ),
    (
      'le-gras', 990,
      'price_1USjWN0StL37D8g90Nv2cyXi',
      'price_1USjXV0StL37D8g9j1ex357b',
      'kanban-2026-10-v1',
      'A ativação do módulo libera o acesso imediatamente. A mensalidade de R$ 9,90 começa a ser cobrada no próximo ciclo da assinatura da organização, sem cobrança proporcional, inclusive após o período de teste. A desativação remove o item recorrente sem crédito proporcional. Os quadros, cards e histórico permanecem armazenados; o módulo fica oculto enquanto inativo. O novo preço vale apenas para novas ativações; o preço aceito permanece nas ativações existentes.',
      v_admin
    ),
    (
      'pro-stetic', 990,
      'price_1USjWN0StL37D8g9QaktB58H',
      'price_1USjXy0StL37D8g9tTyWWKRL',
      'kanban-2026-10-v1',
      'A ativação do módulo libera o acesso imediatamente. A mensalidade de R$ 9,90 começa a ser cobrada no próximo ciclo da assinatura da organização, sem cobrança proporcional, inclusive após o período de teste. A desativação remove o item recorrente sem crédito proporcional. Os quadros, cards e histórico permanecem armazenados; o módulo fica oculto enquanto inativo. O novo preço vale apenas para novas ativações; o preço aceito permanece nas ativações existentes.',
      v_admin
    ),
    (
      'music-pro', 990,
      'price_1USjWN0StL37D8g929jjr8we',
      'price_1USjYR0StL37D8g9NWDOd9tH',
      'kanban-2026-10-v1',
      'A ativação do módulo libera o acesso imediatamente. A mensalidade de R$ 9,90 começa a ser cobrada no próximo ciclo da assinatura da organização, sem cobrança proporcional, inclusive após o período de teste. A desativação remove o item recorrente sem crédito proporcional. Os quadros, cards e histórico permanecem armazenados; o módulo fica oculto enquanto inativo. O novo preço vale apenas para novas ativações; o preço aceito permanece nas ativações existentes.',
      v_admin
    );
end;
$$;

-- Price registration is not authorization to activate the module for tenants.
update public.platform_modules
set active = false, updated_at = now()
where key = 'kanban';

commit;
