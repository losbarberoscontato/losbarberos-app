-- Serviços internos não são exibidos no app nem em pacotes; público não se aplica.
create or replace function public.require_catalog_audiences()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'services'
     and coalesce(to_jsonb(new)->>'availability', 'CLIENT') = 'INTERNAL' then
    return new;
  end if;

  if new.audiences is null or cardinality(new.audiences) = 0 then
    raise exception using errcode = '22023', message = 'catalog item requires at least one audience';
  end if;
  return new;
end;
$$;
