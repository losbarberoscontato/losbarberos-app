import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  createMercadoPagoCheckout,
  claimMyExistingCustomer,
  getAvailableSlots,
  getMyClientAccount,
  getPublicBookingContext,
  linkMyClientToOrganization,
  listMyClientOrganizations,
  recordWhatsappConsent,
  rescheduleAppointment,
  upsertMyClientAccount,
} from "@/components/connected-client/api";

describe("contratos Supabase do cliente conectado", () => {
  it("carrega somente a conta global do usuário autenticado", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        auth_user_id: "user-1",
        full_name: "Ana Souza",
        phone_e164: "+5511999999999",
        phone_verified_at: null,
        birth_date: "1990-02-10",
        terms_policy_version: "client-access-2026-08",
        terms_accepted_at: "2026-08-10T12:00:00Z",
      },
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    const supabase = { from } as unknown as SupabaseClient;

    await expect(getMyClientAccount(supabase, "user-1")).resolves.toMatchObject({
      auth_user_id: "user-1",
      full_name: "Ana Souza",
    });
    expect(from).toHaveBeenCalledWith("client_accounts");
    expect(eq).toHaveBeenCalledWith("auth_user_id", "user-1");
  });

  it("atualiza conta global pela RPC autenticada", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "user-1", error: null });
    const supabase = { rpc } as unknown as SupabaseClient;

    await expect(upsertMyClientAccount(supabase, {
      fullName: "Ana Souza",
      phoneE164: "+5511999999999",
      birthDate: "1990-02-10",
      termsPolicyVersion: "client-access-2026-08",
    })).resolves.toBe("user-1");
    expect(rpc).toHaveBeenCalledWith("upsert_my_client_account", {
      p_full_name: "Ana Souza",
      p_phone_e164: "+5511999999999",
      p_birth_date: "1990-02-10",
      p_terms_policy_version: "client-access-2026-08",
    });
  });

  it("lista somente organizações vinculadas à conta autenticada", async () => {
    const organizations = [{
      organization_id: "organization-1",
      organization_slug: "barbearia-real",
      organization_name: "Barbearia Real",
      customer_id: "customer-1",
    }];
    const rpc = vi.fn().mockResolvedValue({ data: organizations, error: null });
    const supabase = { rpc } as unknown as SupabaseClient;

    await expect(listMyClientOrganizations(supabase)).resolves.toEqual(organizations);
    expect(rpc).toHaveBeenCalledWith("list_my_client_organizations");
  });

  it("aceita retry idempotente do vínculo explícito pelo slug", async () => {
    const relation = {
      status: "LINKED",
      organization_id: "organization-1",
      organization_slug: "barbearia-real",
      customer_id: "customer-1",
    };
    const rpc = vi.fn().mockResolvedValue({ data: relation, error: null });
    const supabase = { rpc } as unknown as SupabaseClient;

    await expect(linkMyClientToOrganization(supabase, "barbearia-real", "organization-1")).resolves.toEqual(relation);
    await expect(linkMyClientToOrganization(supabase, "barbearia-real", "organization-1")).resolves.toEqual(relation);
    expect(rpc).toHaveBeenNthCalledWith(1, "link_my_client_to_organization", {
      p_organization_slug: "barbearia-real",
      p_expected_organization_id: "organization-1",
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "link_my_client_to_organization", {
      p_organization_slug: "barbearia-real",
      p_expected_organization_id: "organization-1",
    });
  });

  it("confirma cadastro existente somente pelo par tenant e customer retornado", async () => {
    const result = {
      status: "LINKED",
      organization_id: "organization-1",
      customer_id: "customer-1",
    };
    const rpc = vi.fn().mockResolvedValue({ data: result, error: null });
    const supabase = { rpc } as unknown as SupabaseClient;

    await expect(claimMyExistingCustomer(supabase, "organization-1", "customer-1")).resolves.toEqual(result);
    expect(rpc).toHaveBeenCalledWith("claim_my_existing_customer", {
      p_organization_id: "organization-1",
      p_customer_id: "customer-1",
    });
  });

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
