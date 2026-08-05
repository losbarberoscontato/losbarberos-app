import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  createMercadoPagoCheckout,
  getAvailableSlots,
  getPublicBookingContext,
  recordWhatsappConsent,
  rescheduleAppointment,
} from "@/components/connected-client/api";

describe("contratos Supabase do cliente conectado", () => {
  it("carrega contexto somente pela projeção pública do slug", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { organization: { slug: "tenant-a" } }, error: null });
    const supabase = { rpc } as unknown as SupabaseClient;
    await expect(getPublicBookingContext(supabase, "tenant-a")).resolves.toMatchObject({ organization: { slug: "tenant-a" } });
    expect(rpc).toHaveBeenCalledWith("get_public_booking_context", { p_organization_slug: "tenant-a" });
  });

  it("consulta slots com organization slug, barbeiro, data e seleção", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { duration_minutes: 35, total_cents: 6500, slots: [] }, error: null });
    const supabase = { rpc } as unknown as SupabaseClient;
    await getAvailableSlots(supabase, {
      organizationSlug: "tenant-a",
      barberId: "00000000-0000-4000-8000-000000000002",
      localDate: "2026-08-10",
      selections: [{ service_id: "00000000-0000-4000-8000-000000000003", quantity: 1 }],
    });
    expect(rpc).toHaveBeenCalledWith("get_available_slots", expect.objectContaining({
      p_organization_slug: "tenant-a",
      p_local_date: "2026-08-10",
    }));
  });

  it("envia Idempotency-Key e aceita somente redirect Mercado Pago HTTPS", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { checkoutUrl: "https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=123" },
      error: null,
    });
    const supabase = { functions: { invoke } } as unknown as SupabaseClient;
    await expect(createMercadoPagoCheckout(supabase, "order-id", "mp-checkout:stable-key")).resolves.toContain("mercadopago.com.br");
    expect(invoke).toHaveBeenCalledWith("mercado-pago-create-checkout", {
      body: { paymentOrderId: "order-id" },
      headers: { "Idempotency-Key": "mp-checkout:stable-key" },
    });
  });

  it("rejeita URL externa mesmo se função retornar sucesso", async () => {
    const supabase = {
      functions: { invoke: vi.fn().mockResolvedValue({ data: { checkoutUrl: "https://evil.example/checkout" }, error: null }) },
    } as unknown as SupabaseClient;
    await expect(createMercadoPagoCheckout(supabase, "order-id", "mp-checkout:stable-key")).rejects.toThrow("URL de checkout inválida");
  });

  it("registra opt-in transacional explícito sem habilitar marketing", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "consent-id", error: null });
    const supabase = { rpc } as unknown as SupabaseClient;
    await recordWhatsappConsent(supabase, {
      organizationId: "organization-id",
      customerId: "customer-id",
      granted: true,
      source: "PWA_BOOKING",
    });
    expect(rpc).toHaveBeenCalledWith("record_consent_event", expect.objectContaining({
      p_kind: "WHATSAPP_TRANSACTIONAL",
      p_action: "GRANTED",
      p_source: "PWA_BOOKING",
      p_proof: expect.objectContaining({ explicit_control: true }),
    }));
  });

  it("preserva seleção quando reagenda sem substituição", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { appointment_id: "appointment-id" }, error: null });
    const supabase = { rpc } as unknown as SupabaseClient;
    await rescheduleAppointment(supabase, {
      appointmentId: "appointment-id",
      barberId: "barber-id",
      startsAt: "2026-08-10T13:00:00Z",
      selections: null,
    });
    expect(rpc).toHaveBeenCalledWith("reschedule_appointment", expect.objectContaining({
      p_appointment_id: "appointment-id",
      p_selections: null,
    }));
  });
});
