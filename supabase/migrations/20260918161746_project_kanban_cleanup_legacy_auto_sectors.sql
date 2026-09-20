-- A primeira versão do Kanban Geral criava automaticamente um setor com o
-- mesmo nome de cada quadro de projeto. Esses registros não foram criados no
-- Kanban Geral pelo usuário e não devem aparecer como setores disponíveis.
-- Preserve os registros para histórico, mas desvincule os quadros e arquive
-- apenas os setores que só possuem quadros com o mesmo nome.
update public.project_kanban_sectors s
   set active = false,
       updated_at = now()
 where s.active
   and exists (
     select 1
       from public.project_kanban_boards linked
      where linked.sector_id = s.id
        and linked.active
        and lower(btrim(linked.name)) = lower(btrim(s.name))
   )
   and not exists (
     select 1
       from public.project_kanban_boards linked
      where linked.sector_id = s.id
        and linked.active
        and lower(btrim(linked.name)) <> lower(btrim(s.name))
   );

update public.project_kanban_boards b
   set sector_id = null,
       updated_at = now()
 where b.sector_id in (
   select s.id
     from public.project_kanban_sectors s
    where not s.active
      and exists (
        select 1
          from public.project_kanban_boards linked
         where linked.sector_id = s.id
           and linked.active
           and lower(btrim(linked.name)) = lower(btrim(s.name))
      )
 );
