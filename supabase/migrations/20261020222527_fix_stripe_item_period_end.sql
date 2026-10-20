-- Stripe API versions from Basil onward expose billing periods on subscription
-- items, not on the subscription object. Normalize the base item's period for
-- the existing provider webhook processor and repair null periods from stored
-- webhook payloads.

create or replace function public.process_stripe_billing_webhook(
  p_event_id text,
  p_event_type text,
  p_event_created_at timestamptz,
  p_livemode boolean,
  p_mapped_status text,
  p_grace_until timestamptz,
  p_payload jsonb
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_payload jsonb := p_payload;
  v_result jsonb;
  v_org uuid;
  v_base text;
  v_items jsonb;
  v_module_item text;
  v_base_period_end text;
begin
  perform public.require_service_role();
  if p_event_type like 'customer.subscription.%' then
    select organization_id, stripe_price_id into v_org, v_base
    from public.saas_subscriptions
    where stripe_subscription_id = p_payload->>'id';
    if v_org is null and (p_payload #>> '{metadata,organization_id}') ~* '^[0-9a-f-]{36}$' then
      v_org := (p_payload #>> '{metadata,organization_id}')::uuid;
      select stripe_price_id into v_base
      from public.saas_subscriptions where organization_id = v_org;
    end if;

    if v_base is not null and jsonb_typeof(p_payload #> '{items,data}') = 'array' then
      select coalesce(jsonb_agg(item order by case when item #>> '{price,id}' = v_base then 0 else 1 end), '[]'::jsonb)
      into v_items from jsonb_array_elements(p_payload #> '{items,data}') item;
      v_payload := jsonb_set(v_payload, '{items,data}', v_items);

      if coalesce((v_payload->>'current_period_end') ~ '^[0-9]+$', false) = false then
        select item->>'current_period_end' into v_base_period_end
        from jsonb_array_elements(p_payload #> '{items,data}') item
        where item #>> '{price,id}' = v_base
          and coalesce((item->>'current_period_end') ~ '^[0-9]+$', false)
        limit 1;
        if v_base_period_end is not null then
          v_payload := jsonb_set(v_payload, '{current_period_end}', to_jsonb(v_base_period_end), true);
        end if;
      end if;
    end if;
  end if;

  v_result := public.process_stripe_billing_webhook_before_kanban(
    p_event_id, p_event_type, p_event_created_at, p_livemode,
    p_mapped_status, p_grace_until, v_payload
  );

  if v_result->>'applied' = 'true' and v_org is not null and p_event_type like 'customer.subscription.%' then
    select item->>'id' into v_module_item
    from public.organization_kanban_billing billing
    join public.platform_kanban_price_versions price on price.id = billing.price_version_id
    cross join lateral jsonb_array_elements(coalesce(p_payload #> '{items,data}', '[]'::jsonb)) item
    where billing.organization_id = v_org
      and item #>> '{price,id}' = case when p_livemode then price.stripe_live_price_id else price.stripe_test_price_id end
      and item #>> '{metadata,module_key}' = 'kanban'
      and item #>> '{metadata,organization_id}' = v_org::text
    limit 1;
    if v_module_item is not null then
      update public.organization_kanban_billing
      set stripe_subscription_item_id = v_module_item, updated_at = now()
      where organization_id = v_org and stripe_subscription_item_id is distinct from v_module_item;
    end if;
  end if;

  return v_result;
end;
$$;

revoke all on function public.process_stripe_billing_webhook(text,text,timestamptz,boolean,text,timestamptz,jsonb)
from public, anon, authenticated;
grant execute on function public.process_stripe_billing_webhook(text,text,timestamptz,boolean,text,timestamptz,jsonb)
to service_role;

with latest_payload as (
  select distinct on (subscription.organization_id)
    subscription.organization_id,
    subscription.stripe_price_id,
    event.payload
  from public.saas_subscriptions subscription
  join public.webhook_events event
    on event.provider = 'STRIPE'
   and event.payload->>'id' = subscription.stripe_subscription_id
   and event.event_type like 'customer.subscription.%'
  order by subscription.organization_id, event.provider_created_at desc nulls last, event.created_at desc
), period_ends as (
  select latest.organization_id,
    coalesce(
      case when (latest.payload->>'current_period_end') ~ '^[0-9]+$'
        then to_timestamp((latest.payload->>'current_period_end')::double precision) end,
      (
        select to_timestamp((item->>'current_period_end')::double precision)
        from jsonb_array_elements(coalesce(latest.payload #> '{items,data}', '[]'::jsonb)) item
        where item #>> '{price,id}' = latest.stripe_price_id
          and coalesce((item->>'current_period_end') ~ '^[0-9]+$', false)
        limit 1
      )
    ) as period_end
  from latest_payload latest
)
update public.saas_subscriptions subscription
set current_period_ends_at = period_ends.period_end
from period_ends
where subscription.organization_id = period_ends.organization_id
  and subscription.current_period_ends_at is null
  and period_ends.period_end is not null;
