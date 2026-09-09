-- Defense in depth: RPCs de assinatura nunca são endpoint anônimo.
revoke execute on function public.activate_customer_subscription(uuid,uuid,date,date,text) from anon;
revoke execute on function public.request_customer_subscription(uuid,uuid,uuid,text,boolean) from anon;
revoke execute on function public.save_subscription_plan(uuid,uuid,text,text,bigint,public.subscription_billing_period,smallint,smallint,public.subscription_payment_method,text,text,jsonb) from anon;
revoke execute on function public.set_organization_module_enabled(uuid,text,boolean) from anon;
revoke execute on function public.organization_module_enabled(uuid,text) from anon;
revoke execute on function public.book_customer_subscription_session(uuid,uuid,uuid,uuid,timestamptz) from anon;
revoke execute on function public.cancel_customer_subscription_session(uuid,uuid,uuid,text) from anon;
revoke execute on function public.record_subscription_payment(uuid,uuid,uuid,bigint,public.subscription_payment_method,text,uuid,uuid,text) from anon;
