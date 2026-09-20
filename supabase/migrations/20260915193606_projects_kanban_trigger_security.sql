alter function public.assign_project_engagement_kanban_board()
  set search_path = public, pg_temp;
revoke all on function public.assign_project_engagement_kanban_board() from public, anon, authenticated;
