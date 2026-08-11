-- Appointment receipts remain payment_transactions source-of-truth.
-- The receipt fields are stored as audit metadata; no financial entry is created.
create or replace function public.record_manual_appointment_receipt(
  p_appointment_id uuid,
  p_amount_cents bigint,
  p_reference text,
  p_idempotency_key text,
  p_receipt jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_transaction_id uuid;
  v_order_id uuid;
begin
  v_transaction_id := public.record_manual_payment(p_appointment_id, p_amount_cents, p_reference, p_idempotency_key);
  select payment_order_id into v_order_id from public.payment_transactions where id = v_transaction_id;
  update public.payment_transactions set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('reference', p_reference, 'receipt', coalesce(p_receipt, '{}'::jsonb)) where id = v_transaction_id;
  update public.payment_orders set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('reference', p_reference, 'receipt', coalesce(p_receipt, '{}'::jsonb)) where id = v_order_id;
  return v_transaction_id;
end;
$$;

revoke all on function public.record_manual_appointment_receipt(uuid, bigint, text, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.record_manual_appointment_receipt(uuid, bigint, text, text, jsonb) to authenticated;
