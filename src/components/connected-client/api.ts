import type { SupabaseClient } from "@supabase/supabase-js";
import { isMercadoPagoCheckoutUrl } from "@/components/connected-client/format";
import type {
  AppointmentItem,
  Availability,
  DateAvailability,
  BookingSelection,
  ClientAccount,
  ClientClaimResult,
  ClientLinkResult,
  ClientOrganization,
  Customer,
  CustomerAppointment,
  FinancialStatus,
  PrivacyRequest,
  PublicBookingContext,
} from "@/components/connected-client/types";

type DatabaseError = { message: string; code?: string } | null;

function assertData<T>(data: T | null, error: DatabaseError, fallback: string): T {
  if (error) throw new Error(error.message || fallback);
  if (data === null) throw new Error(fallback);
  return data;
}

export function toClientError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const message = error.message.toLowerCase();
  if (message.includes("requested slot is no longer available") || error.message.includes("23P01")) {
    return "Horário acabou de ser reservado. Escolha outro; sua reserva anterior continua intacta.";
  }
  if (message.includes("hold expired")) return "Proteção do horário expirou. Escolha o horário novamente.";
  if (message.includes("not accepting")) return "Barbearia não aceita novas reservas agora.";
  if (message.includes("cannot perform") || message.includes("active barber not found")) return "Profissional não executa seleção escolhida. Escolha outro.";
  if (message.includes("mercado pago account is not connected")) return "Pagamento online ainda não foi conectado por esta barbearia.";
  if (message.includes("reschedule deadline")) return "Prazo de reagendamento já terminou.";
  if (message.includes("authentication required") || message.includes("jwt")) return "Sessão expirou. Entre novamente.";
  if (message.includes("client account not found") || message.includes("query returned no rows")) {
    return "Complete seus dados de cliente antes de entrar nesta barbearia.";
  }
  return error.message || fallback;
}

export async function getPublicBookingContext(
  supabase: SupabaseClient,
  slug: string,
): Promise<PublicBookingContext | null> {
  const { data, error } = await supabase.rpc("get_public_booking_context", {
    p_organization_slug: slug,
  });
  if (error) throw new Error(error.message);
  return (data as PublicBookingContext | null) ?? null;
}

export async function getMyClientAccount(
  supabase: SupabaseClient,
  userId: string,
): Promise<ClientAccount | null> {
  const { data, error } = await supabase
    .from("client_accounts")
    .select("auth_user_id,full_name,phone_e164,phone_verified_at,birth_date,terms_policy_version,terms_accepted_at,created_at,updated_at")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ClientAccount | null) ?? null;
}

export async function upsertMyClientAccount(
  supabase: SupabaseClient,
  input: {
    fullName: string;
    phoneE164: string;
    birthDate: string | null;
    termsPolicyVersion: string;
  },
): Promise<string> {
  const { data, error } = await supabase.rpc("upsert_my_client_account", {
    p_full_name: input.fullName,
    p_phone_e164: input.phoneE164,
    p_birth_date: input.birthDate,
    p_terms_policy_version: input.termsPolicyVersion,
  });
  return assertData(data as string | null, error, "Não foi possível salvar conta do cliente.");
}

export async function listMyClientOrganizations(
  supabase: SupabaseClient,
): Promise<ClientOrganization[]> {
  const { data, error } = await supabase.rpc("list_my_client_organizations");
  return assertData(data as ClientOrganization[] | null, error, "Não foi possível carregar barbearias vinculadas.");
}

export async function setMyLastClientOrganization(
  supabase: SupabaseClient,
  organizationSlug: string,
): Promise<void> {
  const { error } = await supabase.rpc("set_my_last_client_organization", {
    p_organization_slug: organizationSlug,
  });
  if (error) throw new Error(error.message);
}

export async function linkMyClientToOrganization(
  supabase: SupabaseClient,
  slug: string,
  expectedOrganizationId: string,
): Promise<ClientLinkResult> {
  const { data, error } = await supabase.rpc("link_my_client_to_organization", {
    p_organization_slug: slug,
    p_expected_organization_id: expectedOrganizationId,
  });
  return assertData(data as ClientLinkResult | null, error, "Não foi possível entrar nesta barbearia.");
}

export async function claimMyExistingCustomer(
  supabase: SupabaseClient,
  organizationId: string,
  customerId: string,
): Promise<ClientClaimResult> {
  const { data, error } = await supabase.rpc("claim_my_existing_customer", {
    p_organization_id: organizationId,
    p_customer_id: customerId,
  });
  return assertData(data as ClientClaimResult | null, error, "Não foi possível confirmar cadastro existente.");
}

export async function getMyCustomer(
  supabase: SupabaseClient,
  organizationId: string,
  userId: string,
): Promise<Customer | null> {
  const { data, error } = await supabase
    .from("customers")
    .select("id,organization_id,auth_user_id,full_name,phone_e164,email,birth_date,created_at")
    .eq("organization_id", organizationId)
    .eq("auth_user_id", userId)
    .eq("active", true)
    .is("merged_into_customer_id", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Customer | null) ?? null;
}

export async function upsertMyCustomer(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    fullName: string;
    phoneE164: string;
    email: string | null;
    birthDate: string | null;
  },
): Promise<string> {
  const { data, error } = await supabase.rpc("upsert_my_customer", {
    p_organization_id: input.organizationId,
    p_full_name: input.fullName,
    p_phone_e164: input.phoneE164,
    p_email: input.email,
    p_birth_date: input.birthDate,
  });
  return assertData(data as string | null, error, "Não foi possível salvar cliente.");
}

export async function getAvailableSlots(
  supabase: SupabaseClient,
  input: {
    organizationSlug: string;
    barberId: string;
    localDate: string;
    selections: BookingSelection[];
  },
): Promise<Availability | null> {
  const { data, error } = await supabase.rpc("get_available_slots", {
    p_organization_slug: input.organizationSlug,
    p_barber_id: input.barberId,
    p_local_date: input.localDate,
    p_selections: input.selections,
  });
  if (error) throw new Error(error.message);
  return (data as Availability | null) ?? null;
}

export async function getPublicBookingOrganization(
  supabase: SupabaseClient,
  bookingPublicId: string,
): Promise<{ id: string; slug: string; name: string } | null> {
  const { data, error } = await supabase.rpc("get_public_booking_organization", {
    p_booking_public_id: bookingPublicId,
  });
  if (error) throw new Error(error.message);
  return (data as { id: string; slug: string; name: string } | null) ?? null;
}

export type WalkinQueueAvailability = {
  organization: { name: string; slug: string; timezone: string };
  slots: Array<{ barber_id: string; barber_name: string; starts_at: string; ends_at: string }>;
};

export async function getWalkinQueueAvailability(
  supabase: SupabaseClient,
  queuePublicId: string,
): Promise<WalkinQueueAvailability | null> {
  const { data, error } = await supabase.rpc("get_walkin_queue_availability", {
    p_queue_public_id: queuePublicId,
  });
  return assertData(data as WalkinQueueAvailability | null, error, "Não foi possível consultar a fila.");
}

export async function createWalkinQueueHold(
  supabase: SupabaseClient,
  input: { queuePublicId: string; barberId: string; startsAt: string },
): Promise<{ hold_id: string; expires_at: string }> {
  const { data, error } = await supabase.rpc("create_walkin_queue_hold", {
    p_queue_public_id: input.queuePublicId,
    p_barber_id: input.barberId,
    p_starts_at: input.startsAt,
  });
  return assertData(data as { hold_id: string; expires_at: string } | null, error, "Esse horário acabou de ser ocupado.");
}

export async function getAvailableSlotsForDate(
  supabase: SupabaseClient,
  input: {
    organizationSlug: string;
    localDate: string;
    selections: BookingSelection[];
  },
): Promise<DateAvailability | null> {
  const { data, error } = await supabase.rpc("get_available_slots_for_date", {
    p_organization_slug: input.organizationSlug,
    p_local_date: input.localDate,
    p_selections: input.selections,
  });
  if (error) throw new Error(error.message);
  return (data as DateAvailability | null) ?? null;
}

export async function createAppointmentHold(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    customerId: string;
    barberId: string;
    startsAt: string;
    selections: BookingSelection[];
    paymentMode: "COUNTER";
    walkinQueueHoldId?: string | null;
  },
): Promise<{
  appointment_id: string;
  status: "CONFIRMED";
  expires_at: null;
  total_cents: number;
  amount_due_now_cents: number;
  service_period: string;
}> {
  const { data, error } = await supabase.rpc("create_appointment_hold", {
    p_organization_id: input.organizationId,
    p_customer_id: input.customerId,
    p_barber_id: input.barberId,
    p_starts_at: input.startsAt,
    p_selections: input.selections,
    p_payment_mode: input.paymentMode,
    p_walkin_queue_hold_id: input.walkinQueueHoldId ?? null,
  });
  return assertData<{
    appointment_id: string;
    status: "CONFIRMED";
    expires_at: null;
    total_cents: number;
    amount_due_now_cents: number;
    service_period: string;
  }>(data, error, "Não foi possível proteger horário.");
}

export async function createPaymentCheckoutOrder(
  supabase: SupabaseClient,
  appointmentId: string,
  idempotencyKey: string,
): Promise<{
  appointment_id: string;
  payment_order_id?: string;
  status: "PENDING_PAYMENT" | "CONFIRMED";
  amount_cents: number;
  currency?: string;
  expires_at?: string;
}> {
  const { data, error } = await supabase.rpc("create_payment_checkout_order", {
    p_appointment_id: appointmentId,
    p_idempotency_key: idempotencyKey,
  });
  return assertData<{
    appointment_id: string;
    payment_order_id?: string;
    status: "PENDING_PAYMENT" | "CONFIRMED";
    amount_cents: number;
    currency?: string;
    expires_at?: string;
  }>(data, error, "Não foi possível iniciar pagamento.");
}

export async function createMercadoPagoCheckout(
  supabase: SupabaseClient,
  paymentOrderId: string,
  idempotencyKey: string,
): Promise<string> {
  const { data, error } = await supabase.functions.invoke("mercado-pago-create-checkout", {
    body: { paymentOrderId },
    headers: { "Idempotency-Key": idempotencyKey },
  });
  if (error) throw new Error(error.message || "Mercado Pago indisponível.");
  const checkoutUrl = (data as { checkoutUrl?: unknown } | null)?.checkoutUrl;
  if (typeof checkoutUrl !== "string" || !isMercadoPagoCheckoutUrl(checkoutUrl)) {
    throw new Error("URL de checkout inválida.");
  }
  return checkoutUrl;
}

type AppointmentRow = Omit<CustomerAppointment, "items" | "financial" | "pending_payment_order_id">;
type FinancialRow = CustomerAppointment["financial"] & { appointment_id: string };
type PaymentOrderRow = { id: string; appointment_id: string; status: string; created_at: string };

export async function getMyAppointments(
  supabase: SupabaseClient,
  organizationId: string,
  customerId: string,
): Promise<CustomerAppointment[]> {
  const { data: appointments, error } = await supabase
    .from("appointments")
    .select("id,organization_id,customer_id,barber_id,status,whatsapp_response_status,service_period,payment_mode,currency,total_cents_snapshot,deposit_required_cents_snapshot,cancellation_lead_minutes_snapshot,created_at")
    .eq("organization_id", organizationId)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (appointments as AppointmentRow[] | null) ?? [];
  if (!rows.length) return [];
  const ids = rows.map((appointment) => appointment.id);
  const [
    { data: items, error: itemsError },
    { data: financial, error: financialError },
    { data: paymentOrders, error: paymentOrdersError },
  ] = await Promise.all([
    supabase
      .from("appointment_items")
      .select("id,appointment_id,selection_key,source,service_id,package_id,service_name_snapshot,quantity,charged_price_cents_snapshot,list_price_cents_snapshot,duration_minutes_snapshot,position")
      .eq("organization_id", organizationId)
      .in("appointment_id", ids)
      .order("position", { ascending: true }),
    supabase
      .from("appointment_financial_summary")
      .select("appointment_id,captured_cents,refunded_cents,net_paid_cents,outstanding_cents,financial_status")
      .eq("organization_id", organizationId)
      .in("appointment_id", ids),
    supabase
      .from("payment_orders")
      .select("id,appointment_id,status,created_at")
      .eq("organization_id", organizationId)
      .in("appointment_id", ids)
      .in("kind", ["DEPOSIT", "FULL"])
      .in("status", ["CREATED", "PENDING"])
      .order("created_at", { ascending: false }),
  ]);
  if (itemsError) throw new Error(itemsError.message);
  if (financialError) throw new Error(financialError.message);
  if (paymentOrdersError) throw new Error(paymentOrdersError.message);
  const itemRows = (items as AppointmentItem[] | null) ?? [];
  const financialRows = (financial as FinancialRow[] | null) ?? [];
  const paymentOrderRows = (paymentOrders as PaymentOrderRow[] | null) ?? [];
  return rows.map((appointment) => ({
    ...appointment,
    pending_payment_order_id: paymentOrderRows.find((item) => item.appointment_id === appointment.id)?.id ?? null,
    items: itemRows.filter((item) => item.appointment_id === appointment.id),
    financial: financialRows.find((item) => item.appointment_id === appointment.id) ?? {
      captured_cents: 0,
      refunded_cents: 0,
      net_paid_cents: 0,
      outstanding_cents: appointment.total_cents_snapshot,
      financial_status: "UNPAID" as FinancialStatus,
    },
  }));
}

export async function cancelAppointment(
  supabase: SupabaseClient,
  appointmentId: string,
  reason: string,
): Promise<{ appointment_id: string; refund_amount_cents: number; refund_order_id: string | null }> {
  const { data, error } = await supabase.rpc("cancel_appointment", {
    p_appointment_id: appointmentId,
    p_reason: reason || "customer_requested",
    p_requested_by_customer: true,
  });
  return assertData<{ appointment_id: string; refund_amount_cents: number; refund_order_id: string | null }>(data, error, "Não foi possível cancelar reserva.");
}

export async function rescheduleAppointment(
  supabase: SupabaseClient,
  input: { appointmentId: string; barberId: string; startsAt: string; selections?: BookingSelection[] | null },
): Promise<{ appointment_id: string; service_period: string; total_cents: number }> {
  const { data, error } = await supabase.rpc("reschedule_appointment", {
    p_appointment_id: input.appointmentId,
    p_new_barber_id: input.barberId,
    p_new_starts_at: input.startsAt,
    p_selections: input.selections ?? null,
    p_override_reason: null,
  });
  return assertData<{ appointment_id: string; service_period: string; total_cents: number }>(data, error, "Não foi possível reagendar reserva.");
}

export async function getCustomerPrivacy(
  supabase: SupabaseClient,
  organizationId: string,
  customerId: string,
): Promise<{ whatsappGranted: boolean; requests: PrivacyRequest[] }> {
  const [{ data: consents, error: consentError }, { data: requests, error: requestError }] = await Promise.all([
    supabase
      .from("consent_events")
      .select("action,occurred_at")
      .eq("organization_id", organizationId)
      .eq("customer_id", customerId)
      .eq("kind", "WHATSAPP_TRANSACTIONAL")
      .order("occurred_at", { ascending: false })
      .limit(1),
    supabase
      .from("privacy_requests")
      .select("id,kind,status,requested_at,due_at")
      .eq("organization_id", organizationId)
      .eq("customer_id", customerId)
      .order("requested_at", { ascending: false }),
  ]);
  if (consentError) throw new Error(consentError.message);
  if (requestError) throw new Error(requestError.message);
  const latest = (consents as { action: "GRANTED" | "REVOKED" }[] | null)?.[0];
  return {
    whatsappGranted: latest?.action === "GRANTED",
    requests: (requests as PrivacyRequest[] | null) ?? [],
  };
}

export async function recordWhatsappConsent(
  supabase: SupabaseClient,
  input: { organizationId: string; customerId: string; granted: boolean; source?: "PWA_PROFILE" | "PWA_BOOKING" },
): Promise<string> {
  const { data, error } = await supabase.rpc("record_consent_event", {
    p_organization_id: input.organizationId,
    p_customer_id: input.customerId,
    p_kind: "WHATSAPP_TRANSACTIONAL",
    p_action: input.granted ? "GRANTED" : "REVOKED",
    p_source: input.source ?? "PWA_PROFILE",
    p_proof: { interface: "connected-client", locale: "pt-BR", explicit_control: true },
    p_policy_version: "mvp-2026-08",
  });
  return assertData(data as string | null, error, "Não foi possível atualizar consentimento.");
}

export async function submitPrivacyRequest(
  supabase: SupabaseClient,
  input: { organizationId: string; customerId: string; kind: PrivacyRequest["kind"] },
): Promise<string> {
  const { data, error } = await supabase.rpc("submit_privacy_request", {
    p_organization_id: input.organizationId,
    p_customer_id: input.customerId,
    p_kind: input.kind,
  });
  return assertData(data as string | null, error, "Não foi possível abrir solicitação.");
}
