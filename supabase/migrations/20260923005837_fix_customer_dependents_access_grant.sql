-- RLS policies invoke this SECURITY DEFINER helper as the authenticated role.
-- Keep it unavailable to anonymous callers while allowing authenticated RLS
-- evaluation to execute the authorization predicate.
grant execute on function public.can_access_customer_dependents(uuid, uuid)
  to authenticated;
