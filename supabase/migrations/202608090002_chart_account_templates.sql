-- Global management chart based on Plano_de_Contas_Simplificado_Barbearia.pdf.
-- Tenant chart rows remain in public.chart_of_accounts and preserve organization_id isolation.

create table public.default_chart_account_templates (
  code text primary key check (code ~ '^[1-9][0-9]*(\.[1-9][0-9]*)*$'),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  kind public.financial_entry_kind not null,
  parent_code text references public.default_chart_account_templates(code),
  check (parent_code is null or parent_code <> code)
);

alter table public.default_chart_account_templates enable row level security;
revoke all on table public.default_chart_account_templates from public, anon, authenticated;

insert into public.default_chart_account_templates (code, name, kind, parent_code) values
  ('1', 'Receitas', 'REVENUE', null),
  ('1.1', 'Receitas de Serviços', 'REVENUE', '1'),
  ('1.1.1', 'Corte de cabelo', 'REVENUE', '1.1'),
  ('1.1.2', 'Barba', 'REVENUE', '1.1'),
  ('1.1.3', 'Combos de corte e barba', 'REVENUE', '1.1'),
  ('1.1.4', 'Serviços adicionais', 'REVENUE', '1.1'),
  ('1.2', 'Venda de Produtos', 'REVENUE', '1'),
  ('1.2.1', 'Produtos para cabelo', 'REVENUE', '1.2'),
  ('1.2.2', 'Produtos para barba e cuidados pessoais', 'REVENUE', '1.2'),
  ('1.3', 'Outras Receitas', 'REVENUE', '1'),
  ('1.3.1', 'Aluguel de cadeira', 'REVENUE', '1.3'),
  ('1.3.2', 'Parcerias e outras receitas', 'REVENUE', '1.3'),
  ('2', 'Despesas', 'EXPENSE', null),
  ('2.1', 'Pessoal e Profissionais', 'EXPENSE', '2'),
  ('2.1.1', 'Salários e pró-labore', 'EXPENSE', '2.1'),
  ('2.1.2', 'Comissões dos barbeiros', 'EXPENSE', '2.1'),
  ('2.1.3', 'Encargos trabalhistas e benefícios', 'EXPENSE', '2.1'),
  ('2.2', 'Estrutura e Funcionamento', 'EXPENSE', '2'),
  ('2.2.1', 'Aluguel, condomínio e IPTU', 'EXPENSE', '2.2'),
  ('2.2.2', 'Água e energia elétrica', 'EXPENSE', '2.2'),
  ('2.2.3', 'Internet e telefone', 'EXPENSE', '2.2'),
  ('2.2.4', 'Limpeza, lavanderia e segurança', 'EXPENSE', '2.2'),
  ('2.3', 'Materiais e Mercadorias', 'EXPENSE', '2'),
  ('2.3.1', 'Materiais de consumo e descartáveis', 'EXPENSE', '2.3'),
  ('2.3.2', 'Produtos adquiridos para revenda', 'EXPENSE', '2.3'),
  ('2.4', 'Marketing e Vendas', 'EXPENSE', '2'),
  ('2.4.1', 'Publicidade e promoções', 'EXPENSE', '2.4'),
  ('2.4.2', 'Plataformas de agendamento e comissões', 'EXPENSE', '2.4'),
  ('2.5', 'Manutenção e Equipamentos', 'EXPENSE', '2'),
  ('2.5.1', 'Manutenções e reparos', 'EXPENSE', '2.5'),
  ('2.5.2', 'Equipamentos, móveis e utensílios', 'EXPENSE', '2.5'),
  ('2.6', 'Impostos e Administração', 'EXPENSE', '2'),
  ('2.6.1', 'Impostos e tributos', 'EXPENSE', '2.6'),
  ('2.6.2', 'Contabilidade, licenças e alvarás', 'EXPENSE', '2.6'),
  ('2.6.3', 'Sistemas e materiais administrativos', 'EXPENSE', '2.6'),
  ('2.7', 'Despesas Financeiras', 'EXPENSE', '2'),
  ('2.7.1', 'Tarifas bancárias', 'EXPENSE', '2.7'),
  ('2.7.2', 'Taxas de cartões e meios de pagamento', 'EXPENSE', '2.7'),
  ('2.7.3', 'Juros e multas', 'EXPENSE', '2.7'),
  ('2.8', 'Outras Despesas', 'EXPENSE', '2'),
  ('2.8.1', 'Perdas, quebras e avarias', 'EXPENSE', '2.8'),
  ('2.8.2', 'Outras despesas operacionais', 'EXPENSE', '2.8')
on conflict (code) do update
set name = excluded.name,
    kind = excluded.kind,
    parent_code = excluded.parent_code;

create or replace function public.seed_default_chart_of_accounts(
  p_organization_id uuid,
  p_created_by uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inserted integer := 0;
begin
  if p_organization_id is null or not exists (
    select 1 from public.organizations where id = p_organization_id
  ) then
    raise exception using errcode = 'P0002', message = 'organization not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text, 202608090002));

  if exists (
    select 1 from public.chart_of_accounts where organization_id = p_organization_id
  ) then
    return 0;
  end if;

  insert into public.chart_of_accounts (
    organization_id, parent_id, code, name, kind, created_by
  )
  select p_organization_id, null, template.code, template.name, template.kind, p_created_by
  from public.default_chart_account_templates template
  order by string_to_array(template.code, '.')::integer[];

  get diagnostics v_inserted = row_count;

  update public.chart_of_accounts child
  set parent_id = parent.id
  from public.default_chart_account_templates template
  join public.chart_of_accounts parent
    on parent.organization_id = p_organization_id
   and parent.code = template.parent_code
   and parent.kind = template.kind
  where child.organization_id = p_organization_id
    and child.code = template.code
    and template.parent_code is not null;

  if exists (
    select 1
    from public.default_chart_account_templates template
    where template.parent_code is not null
      and not exists (
        select 1
        from public.chart_of_accounts child
        where child.organization_id = p_organization_id
          and child.code = template.code
          and child.parent_id is not null
      )
  ) then
    raise exception using errcode = '23503', message = 'default chart account parent resolution failed';
  end if;

  return v_inserted;
end;
$$;

create or replace function public.seed_default_chart_accounts_on_organization_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.seed_default_chart_of_accounts(new.id, new.created_by);
  return new;
end;
$$;

create trigger organizations_seed_default_chart_accounts
after insert on public.organizations
for each row execute function public.seed_default_chart_accounts_on_organization_insert();

create or replace function public.replace_chart_of_accounts_from_default(
  p_organization_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_organization_id is null or not exists (
    select 1 from public.organizations where id = p_organization_id
  ) then
    raise exception using errcode = 'P0002', message = 'organization not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text, 202608090002));

  if exists (
    select 1
    from public.financial_entries
    where organization_id = p_organization_id
  ) then
    raise exception using errcode = '22023', message = 'financial entries reference the current chart of accounts';
  end if;

  delete from public.chart_of_accounts
  where organization_id = p_organization_id;

  return public.seed_default_chart_of_accounts(p_organization_id);
end;
$$;

revoke all on function public.seed_default_chart_of_accounts(uuid, uuid) from public, anon, authenticated;
revoke all on function public.seed_default_chart_accounts_on_organization_insert() from public, anon, authenticated;
revoke all on function public.replace_chart_of_accounts_from_default(uuid) from public, anon, authenticated;
