-- O cliente pode somente marcar a própria notificação como lida.
revoke update on public.customer_in_app_notifications from authenticated;
grant update (read_at) on public.customer_in_app_notifications to authenticated;
