import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConnectedClientProvider } from "@/components/connected-client/context";
import { ClientAuthForm } from "@/components/connected-client/auth-form";
import { filterByAudience } from "@/lib/catalog-audiences";
import { ConnectedClientGate } from "@/components/connected-client/state";
import {
  bookingSelection,
  canCustomerReschedule,
  catalogChoices,
  parsePostgresRange,
  resolveTenantSlug,
  selectionsFromAppointmentItems,
} from "@/components/connected-client/format";
import type { AppointmentItem, PublicBookingContext } from "@/components/connected-client/types";

const authMocks = vi.hoisted(() => ({
  client: null as {
    auth: {
      signUp: ReturnType<typeof vi.fn>;
      signInWithPassword: ReturnType<typeof vi.fn>;
      resetPasswordForEmail: ReturnType<typeof vi.fn>;
      resend: ReturnType<typeof vi.fn>;
    };
    rpc: ReturnType<typeof vi.fn>;
  } | null,
  push: vi.fn(),
}));

vi.mock("@/lib/supabase/browser", () => ({
  getSupabaseBrowserClient: () => authMocks.client,
}));

vi.mock("next/navigation", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  useRouter: () => ({ push: authMocks.push }),
}));

const context: PublicBookingContext = {
  organization: {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Barbearia Real",
    slug: "barbearia-real",
    timezone: "America/Sao_Paulo",
    currency: "BRL",
    deposit_bps: 3000,
    cancellation_lead_minutes: 1440,
    accepting_bookings: true,
  },
  location: null,
  services: [{ id: "service-1", name: "Corte", description: null, price_cents: 6500, duration_minutes: 35, audiences: ["MASCULINO"] }],
  packages: [{
    id: "package-1",
    name: "Combo",
    description: "Corte e barba",
    price_cents: 10500,
    audiences: ["MASCULINO"],
    items: [
      { service_id: "service-1", name: "Corte", quantity: 1, duration_minutes: 35 },
      { service_id: "service-2", name: "Barba", quantity: 1, duration_minutes: 30 },
    ],
  }],
  barbers: [],
};

describe("cliente conectado", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("resolve slug seguro priorizando rota, query e storage", () => {
    expect(resolveTenantSlug("query-slug", "stored-slug", "route-slug")).toBe("route-slug");
    expect(resolveTenantSlug("Barbearia-Real", null)).toBe("barbearia-real");
    expect(resolveTenantSlug("../tenant", "slug-valido")).toBe("slug-valido");
  });

  it("cria seleção RPC usando contrato do catálogo", () => {
    const choices = catalogChoices(context);
    expect(choices[1].durationMinutes).toBe(65);
    expect(bookingSelection(choices[0])).toEqual([{ service_id: "service-1", quantity: 1 }]);
    expect(bookingSelection(choices[1])).toEqual([{ package_id: "package-1", quantity: 1 }]);
  });

  it("filtra serviços e pacotes pelo público escolhido", () => {
    const choices = catalogChoices(context);
    expect(filterByAudience(choices, "MASCULINO").map((choice) => choice.name)).toEqual(["Corte", "Combo"]);
    expect(filterByAudience(choices, "INFANTIL")).toEqual([]);
  });

  it("preserva agrupamento original ao consultar reagendamento", () => {
    const items: AppointmentItem[] = [
      { id: "1", appointment_id: "a", selection_key: "selection-a", source: "PACKAGE", service_id: "service-1", package_id: "package-1", service_name_snapshot: "Corte", quantity: 1, charged_price_cents_snapshot: 5000, list_price_cents_snapshot: 6500, duration_minutes_snapshot: 35, position: 1 },
      { id: "2", appointment_id: "a", selection_key: "selection-a", source: "PACKAGE", service_id: "service-2", package_id: "package-1", service_name_snapshot: "Barba", quantity: 1, charged_price_cents_snapshot: 5500, list_price_cents_snapshot: 5500, duration_minutes_snapshot: 30, position: 2 },
    ];
    expect(selectionsFromAppointmentItems(items)).toEqual([{ package_id: "package-1", quantity: 1 }]);
  });

  it("interpreta tstzrange e respeita prazo de reagendamento", () => {
    const range = parsePostgresRange('["2026-08-10 13:00:00+00","2026-08-10 13:45:00+00")');
    expect(range).toEqual({ startsAt: "2026-08-10 13:00:00+00", endsAt: "2026-08-10 13:45:00+00" });
    expect(canCustomerReschedule("CONFIRMED", "2026-08-10T13:00:00Z", 1440, true, new Date("2026-08-09T12:59:00Z"))).toBe(true);
    expect(canCustomerReschedule("CONFIRMED", "2026-08-10T13:00:00Z", 1440, true, new Date("2026-08-09T13:01:00Z"))).toBe(false);
    expect(canCustomerReschedule("CONFIRMED", "2026-08-10T13:00:00Z", 1440, false, new Date("2026-08-01T00:00:00Z"))).toBe(false);
  });

  it("não renderiza conteúdo privado sem tenant resolvido", async () => {
    authMocks.client = null;
    render(<ConnectedClientProvider><ConnectedClientGate><div>conteúdo privado</div></ConnectedClientGate></ConnectedClientProvider>);
    expect(await screen.findByRole("heading", { name: "Qual barbearia?" })).toBeInTheDocument();
    expect(screen.queryByText("conteúdo privado")).not.toBeInTheDocument();
  });
  beforeEach(() => {
    authMocks.push.mockReset();
    authMocks.client = {
      auth: {
        signUp: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" }, session: null }, error: null }),
        signInWithPassword: vi.fn().mockResolvedValue({
          data: {
            user: {
              email: "ana@example.com",
              user_metadata: {
                full_name: "Ana Souza",
                phone_e164_candidate: "+5511999999999",
                birth_date: "1990-02-10",
                terms_policy_version: "client-access-2026-08",
              },
            },
            session: { access_token: "session" },
          },
          error: null,
        }),
        resetPasswordForEmail: vi.fn().mockResolvedValue({ data: {}, error: null }),
        resend: vi.fn().mockResolvedValue({ data: {}, error: null }),
      },
      rpc: vi.fn().mockResolvedValue({ data: "account-1", error: null }),
    };
  });

  it("separa entrar de criar conta, com campos completos e sem Google", () => {
    render(<ClientAuthForm initialSlug="barbearia-real" initialNext="/cliente/agendar" />);

    expect(screen.getByRole("heading", { name: "Acesse sua barbearia" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Entrar" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("Continuar com Google")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Criar conta" }));

    expect(screen.getByLabelText("Nome completo")).toBeRequired();
    expect(screen.getByLabelText("Telefone (E.164)")).toBeRequired();
    expect(screen.getByLabelText("Data de nascimento")).toBeRequired();
    expect(screen.getByLabelText("Aceito os termos de uso e a política de privacidade")).toBeRequired();
  });

  it("valida signup e envia callback allowlisted sem declarar telefone verificado", async () => {
    render(<ClientAuthForm initialSlug="barbearia-real" initialNext="/cliente/agendar" />);
    fireEvent.click(screen.getByRole("tab", { name: "Criar conta" }));
    fireEvent.change(screen.getByLabelText("Nome completo"), { target: { value: " Ana Souza " } });
    fireEvent.change(screen.getByLabelText("Telefone (E.164)"), { target: { value: "+5511999999999" } });
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: " ANA@EXAMPLE.COM " } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "Senha#123" } });
    fireEvent.change(screen.getByLabelText("Data de nascimento"), { target: { value: "1990-02-10" } });
    fireEvent.click(screen.getByLabelText("Aceito os termos de uso e a política de privacidade"));
    fireEvent.submit(screen.getByRole("form", { name: "Criar conta" }));

    await waitFor(() => expect(authMocks.client?.auth.signUp).toHaveBeenCalledWith({
      email: "ana@example.com",
      password: "Senha#123",
      options: {
        data: {
          full_name: "Ana Souza",
          phone_e164_candidate: "+5511999999999",
          birth_date: "1990-02-10",
          terms_policy_version: "client-access-2026-08",
        },
        emailRedirectTo: "http://localhost:3000/auth/callback?next=%2Fcliente%2Fagendar&barbearia=barbearia-real",
      },
    }));
    expect(authMocks.client?.auth.signUp.mock.calls[0]?.[0].options.data).not.toHaveProperty("phone_verified");
    expect(authMocks.client?.rpc).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Confira seu e-mail");
  });

  it("sincroniza conta global somente depois de signin confirmado", async () => {
    render(<ClientAuthForm initialSlug="barbearia-real" initialNext="/cliente/agendar" />);
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "ana@example.com" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "Senha#123" } });
    fireEvent.submit(screen.getByRole("form", { name: "Entrar" }));

    await waitFor(() => expect(authMocks.client?.rpc).toHaveBeenCalledWith("upsert_my_client_account", {
      p_full_name: "Ana Souza",
      p_phone_e164: "+5511999999999",
      p_birth_date: "1990-02-10",
      p_terms_policy_version: "client-access-2026-08",
    }));
    expect(authMocks.push).toHaveBeenCalledWith("/cliente/agendar?barbearia=barbearia-real");
  });

  it("pede completar cadastro quando signin retorna metadata insuficiente", async () => {
    authMocks.client!.auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: { email: "ana@example.com", user_metadata: { full_name: "Ana" } }, session: { access_token: "session" } },
      error: null,
    });
    render(<ClientAuthForm initialSlug="barbearia-real" initialNext="/cliente/agendar" />);
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "ana@example.com" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "Senha#123" } });
    fireEvent.submit(screen.getByRole("form", { name: "Entrar" }));

    expect(await screen.findByRole("heading", { name: "Complete seu cadastro" })).toBeInTheDocument();
    expect(authMocks.client?.rpc).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Telefone (E.164)")).toBeRequired();
  });

  it("usa callback allowlisted em recuperação e reenvio", async () => {
    render(<ClientAuthForm initialSlug="barbearia-real" initialNext="https://evil.example" />);
    fireEvent.click(screen.getByRole("button", { name: "Esqueci minha senha" }));
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "ana@example.com" } });
    fireEvent.submit(screen.getByRole("form", { name: "Recuperar senha" }));

    await waitFor(() => expect(authMocks.client?.auth.resetPasswordForEmail).toHaveBeenCalledWith("ana@example.com", {
      redirectTo: "http://localhost:3000/auth/callback?next=%2Fcliente&barbearia=barbearia-real",
    }));

    fireEvent.click(screen.getByRole("tab", { name: "Criar conta" }));
    fireEvent.click(screen.getByRole("button", { name: "Reenviar confirmação" }));
    await waitFor(() => expect(authMocks.client?.auth.resend).toHaveBeenCalledWith({
      type: "signup",
      email: "ana@example.com",
      options: { emailRedirectTo: "http://localhost:3000/auth/callback?next=%2Fcliente&barbearia=barbearia-real" },
    }));
  });

  it("não chama Supabase sem configuração", () => {
    authMocks.client = null;
    render(<ClientAuthForm initialSlug="barbearia-real" initialNext="/cliente" />);
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "ana@example.com" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "Senha#123" } });
    fireEvent.submit(screen.getByRole("form", { name: "Entrar" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Acesso online indisponível.");
  });
});
