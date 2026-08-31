import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConnectedClientProvider, useConnectedClient } from "@/components/connected-client/context";
import { ClientAuthForm, ClientPasswordResetForm } from "@/components/connected-client/auth-form";
import { ConnectedClientHome } from "@/components/connected-client/home";
import { ConnectedBooking } from "@/components/connected-client/booking";
import { ConnectedProfile } from "@/components/connected-client/profile";
import ClientPasswordResetPage from "@/app/cliente/redefinir-senha/page";
import ClientEntryPage from "@/app/cliente/entrar/page";
import PublicBarbershopPage from "@/app/b/[slug]/page";
import { filterByAudience } from "@/lib/catalog-audiences";
import { AuthPrompt, ConnectedClientGate } from "@/components/connected-client/state";
import {
  bookingSelection,
  canCustomerReschedule,
  catalogChoices,
  filterByChoiceKind,
  parsePostgresRange,
  resolveTenantSlug,
  selectionsFromAppointmentItems,
} from "@/components/connected-client/format";
import type { AppointmentItem, PublicBookingContext } from "@/components/connected-client/types";

const authMocks = vi.hoisted(() => ({
  client: null as {
    auth: {
      signUp: ReturnType<typeof vi.fn>;
      signInWithOAuth: ReturnType<typeof vi.fn>;
      signInWithPassword: ReturnType<typeof vi.fn>;
      resetPasswordForEmail: ReturnType<typeof vi.fn>;
      resend: ReturnType<typeof vi.fn>;
      getSession: ReturnType<typeof vi.fn>;
      exchangeCodeForSession: ReturnType<typeof vi.fn>;
      signOut: ReturnType<typeof vi.fn>;
      updateUser: ReturnType<typeof vi.fn>;
      getUser: ReturnType<typeof vi.fn>;
      onAuthStateChange?: ReturnType<typeof vi.fn>;
    };
    rpc: ReturnType<typeof vi.fn>;
    from?: ReturnType<typeof vi.fn>;
  } | null,
  push: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/supabase/browser", () => ({
  getSupabaseBrowserClient: () => authMocks.client,
}));

vi.mock("next/navigation", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  useRouter: () => ({ push: authMocks.push }),
  redirect: authMocks.redirect,
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
  barbers: [{ id: "barber-1", name: "Diego", bio: null, avatar_url: null, service_ids: ["service-1", "service-2"] }],
};

function queryResult(data: unknown | (() => unknown)) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    order: vi.fn(),
    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    maybeSingle: vi.fn().mockImplementation(() => Promise.resolve({
      data: typeof data === "function" ? data() : data,
      error: null,
    })),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.is.mockReturnValue(query);
  query.order.mockReturnValue(query);
  return query;
}

function installProviderClient({
  authenticated,
  failFirstLink = false,
  deferAuth = false,
  deferLink = false,
  deferClaim = false,
  initiallyLinked = false,
  isLast = false,
  claimRequired = false,
  reviewAfterClaim = false,
  mismatchedClaim = false,
  mismatchedLink = false,
  missingAccount = false,
  accountAvailableAfterUpsert = false,
  canonicalSlug = null,
  bookingHoldConflict = false,
  bookingHoldExpiresInMs = 3 * 60_000,
}: {
  authenticated: boolean;
  failFirstLink?: boolean;
  deferAuth?: boolean;
  deferLink?: boolean;
  deferClaim?: boolean;
  initiallyLinked?: boolean;
  isLast?: boolean;
  claimRequired?: boolean;
  reviewAfterClaim?: boolean;
  mismatchedClaim?: boolean;
  mismatchedLink?: boolean;
  missingAccount?: boolean;
  accountAvailableAfterUpsert?: boolean;
  canonicalSlug?: string | null;
  bookingHoldConflict?: boolean;
  bookingHoldExpiresInMs?: number;
}) {
  const user = authenticated
    ? { id: "user-1", email: "ana@example.com", user_metadata: { full_name: "Ana Souza" } }
    : null;
  const account = {
    auth_user_id: "user-1",
    full_name: "Ana Souza",
    phone_e164: "+5511999999999",
    phone_verified_at: null,
    birth_date: "1990-02-10",
    terms_policy_version: "client-access-2026-08",
    terms_accepted_at: "2026-08-10T12:00:00Z",
  };
  const customer = {
    id: "customer-1",
    organization_id: context.organization.id,
    auth_user_id: "user-1",
    full_name: "Ana Souza",
    phone_e164: "+5511999999999",
    email: "ana@example.com",
    birth_date: "1990-02-10",
  };
  const relation = {
    organization_id: context.organization.id,
    organization_slug: context.organization.slug,
    organization_name: context.organization.name,
    customer_id: customer.id,
    is_last: isLast,
  };
  const publicContext = canonicalSlug
    ? { ...context, organization: { ...context.organization, slug: canonicalSlug } }
    : context;
  let accountVisible = !missingAccount;
  const accountQuery = queryResult(() => accountVisible ? account : null);
  const customerQuery = queryResult(customer);
  const from = vi.fn((table: string) => table === "client_accounts" ? accountQuery : customerQuery);
  let linked = initiallyLinked;
  let firstLink = failFirstLink;
  let resolveAuth: (() => void) | null = null;
  let resolveLink: (() => void) | null = null;
  let resolveClaim: (() => void) | null = null;
  const authResult = { data: { user }, error: null };
  const authPromise = deferAuth
    ? new Promise<typeof authResult>((resolve) => {
        resolveAuth = () => resolve(authResult);
      })
    : Promise.resolve(authResult);
  const linkResult = {
    data: {
      status: "LINKED",
      organization_id: mismatchedLink ? "organization-other" : relation.organization_id,
      organization_slug: mismatchedLink ? "outra-barbearia" : relation.organization_slug,
      customer_id: relation.customer_id,
    },
    error: null,
  };
  const linkPromise = deferLink
    ? new Promise<typeof linkResult>((resolve) => {
        resolveLink = () => {
          linked = true;
          resolve(linkResult);
        };
      })
    : null;
  const claimResult = {
    data: {
      status: reviewAfterClaim ? "REVIEW_REQUIRED" : "LINKED",
      organization_id: mismatchedClaim ? "organization-other" : relation.organization_id,
      customer_id: mismatchedClaim ? "customer-other" : relation.customer_id,
    },
    error: null,
  };
  const claimPromise = deferClaim
    ? new Promise<typeof claimResult>((resolve) => {
        resolveClaim = () => {
          if (!reviewAfterClaim && !mismatchedClaim) linked = true;
          resolve(claimResult);
        };
      })
    : null;
  const rpc = vi.fn(async (name: string) => {
    if (name === "get_public_booking_context") return { data: publicContext, error: null };
    if (name === "get_available_slots_for_date") return {
      data: {
        duration_minutes: 35,
        total_cents: 6500,
        options: [{ barber_id: "barber-1", barber_name: "Diego", starts_at: "2026-08-10T12:00:00Z", ends_at: "2026-08-10T12:35:00Z" }],
      },
      error: null,
    };
    if (name === "create_customer_booking_hold" && bookingHoldConflict) return {
      data: null,
      error: { code: "23P01", message: "requested slot is no longer available" },
    };
    if (name === "create_customer_booking_hold") return {
      data: {
        appointment_id: "appointment-hold-1",
        status: "HELD",
        expires_at: new Date(Date.now() + bookingHoldExpiresInMs).toISOString(),
        total_cents: 6500,
        amount_due_now_cents: 0,
        service_period: "[2026-08-10T12:00:00Z,2026-08-10T12:35:00Z)",
      },
      error: null,
    };
    if (name === "confirm_customer_booking_hold") return {
      data: {
        appointment_id: "appointment-hold-1",
        status: "CONFIRMED",
        service_period: "[2026-08-10T12:00:00Z,2026-08-10T12:35:00Z)",
      },
      error: null,
    };
    if (name === "release_customer_booking_hold") return {
      data: { appointment_id: "appointment-hold-1", status: "EXPIRED" },
      error: null,
    };
    if (name === "list_my_client_organizations") return { data: linked ? [relation] : [], error: null };
    if (name === "link_my_client_to_organization") {
      if (linkPromise) return linkPromise;
      if (firstLink) {
        firstLink = false;
        return { data: null, error: { message: "network interrupted after commit" } };
      }
      if (claimRequired) {
        return {
          data: {
            status: "CLAIM_REQUIRED",
            organization_id: relation.organization_id,
            organization_slug: relation.organization_slug,
            customer_id: relation.customer_id,
          },
          error: null,
        };
      }
      linked = true;
      return linkResult;
    }
    if (name === "claim_my_existing_customer") {
      if (claimPromise) return claimPromise;
      if (!reviewAfterClaim && !mismatchedClaim) linked = true;
      return claimResult;
    }
    if (name === "upsert_my_client_account") {
      if (accountAvailableAfterUpsert) accountVisible = true;
      return { data: "user-1", error: null };
    }
    throw new Error(`RPC inesperada: ${name}`);
  });
  authMocks.client = {
    ...authMocks.client!,
    auth: {
      ...authMocks.client!.auth,
      getUser: vi.fn().mockReturnValue(authPromise),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
    rpc,
    from,
  };
  return {
    from,
    rpc,
    resolveAuth: () => resolveAuth?.(),
    resolveClaim: () => resolveClaim?.(),
    resolveLink: () => resolveLink?.(),
  };
}

function ConcurrentLinkProbe() {
  const { confirmTenantLink, linkStatus } = useConnectedClient();
  return (
    <div>
      <output aria-label="status do vínculo">{linkStatus}</output>
      <button type="button" onClick={() => {
        void Promise.all([confirmTenantLink(), confirmTenantLink()]);
      }}>
        Confirmar duas vezes
      </button>
    </div>
  );
}

function ProviderStateProbe() {
  const { account, organizations, customer, switchTenant } = useConnectedClient();
  return (
    <div>
      <span>{account?.full_name ?? "sem conta"}</span>
      <span>{organizations.length} barbearia vinculada</span>
      <span>{customer?.id ?? "sem customer"}</span>
      <button type="button" onClick={() => switchTenant("barbearia-real")}>Trocar barbearia</button>
    </div>
  );
}

describe("cliente conectado", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it("resolve slug seguro priorizando rota, query e storage", () => {
    expect(resolveTenantSlug("query-slug", "stored-slug", "route-slug")).toBe("route-slug");
    expect(resolveTenantSlug("Barbearia-Real", null)).toBe("barbearia-real");
    expect(resolveTenantSlug("../tenant", "slug-valido")).toBe("slug-valido");
  });

  it("cria seleção RPC usando contrato do catálogo", () => {
    const choices = catalogChoices(context);
    expect(choices[1].durationMinutes).toBe(65);
    expect(bookingSelection(choices[0])).toEqual([{ type: "SERVICE", service_id: "service-1", quantity: 1 }]);
    expect(bookingSelection(choices[1])).toEqual([{ type: "PACKAGE", package_id: "package-1", quantity: 1 }]);
  });

  it("filtra serviços e pacotes pelo público escolhido", () => {
    const choices = catalogChoices(context);
    expect(filterByAudience(choices, "MASCULINO").map((choice) => choice.name)).toEqual(["Corte", "Combo"]);
    expect(filterByAudience(choices, "INFANTIL")).toEqual([]);
  });

  it("filtra escolhas por tipo de catÃ¡logo", () => {
    const choices = catalogChoices(context);
    expect(filterByChoiceKind(choices, "SERVICE").map((choice) => choice.name)).toEqual(["Corte"]);
    expect(filterByChoiceKind(choices, "PACKAGE").map((choice) => choice.name)).toEqual(["Combo"]);
    expect(filterByChoiceKind(choices, "ALL")).toHaveLength(2);
  });

  it("preserva agrupamento original ao consultar reagendamento", () => {
    const items: AppointmentItem[] = [
      { id: "1", appointment_id: "a", selection_key: "selection-a", source: "PACKAGE", service_id: "service-1", package_id: "package-1", service_name_snapshot: "Corte", quantity: 1, charged_price_cents_snapshot: 5000, list_price_cents_snapshot: 6500, duration_minutes_snapshot: 35, position: 1 },
      { id: "2", appointment_id: "a", selection_key: "selection-a", source: "PACKAGE", service_id: "service-2", package_id: "package-1", service_name_snapshot: "Barba", quantity: 1, charged_price_cents_snapshot: 5500, list_price_cents_snapshot: 5500, duration_minutes_snapshot: 30, position: 2 },
    ];
    expect(selectionsFromAppointmentItems(items)).toEqual([{ type: "PACKAGE", package_id: "package-1", quantity: 1 }]);
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
    authMocks.redirect.mockReset();
    authMocks.client = {
      auth: {
        signUp: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" }, session: null }, error: null }),
        signInWithOAuth: vi.fn().mockResolvedValue({ data: { provider: "google", url: "https://accounts.google.test" }, error: null }),
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
        getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "session" } }, error: null }),
        exchangeCodeForSession: vi.fn().mockResolvedValue({
          data: {
            user: { id: "user-1" },
            session: { access_token: "recovery-session" },
            redirectType: "recovery",
          },
          error: null,
        }),
        signOut: vi.fn().mockResolvedValue({ error: null }),
        updateUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: "user-1",
              email: "ana@example.com",
              user_metadata: { full_name: "Ana Souza" },
            },
          },
          error: null,
        }),
      },
      rpc: vi.fn().mockResolvedValue({ data: "account-1", error: null }),
    };
  });

  it("exige confirmação explícita antes de carregar cliente tenant e aceita retry idempotente", async () => {
    const { from, rpc } = installProviderClient({ authenticated: true, failFirstLink: true });

    render(
      <ConnectedClientProvider initialSlug="barbearia-real">
        <ConnectedClientGate><div>conteúdo tenant</div></ConnectedClientGate>
      </ConnectedClientProvider>,
    );

    const enter = await screen.findByRole("button", { name: "Entrar nesta barbearia" });
    expect(screen.queryByText("conteúdo tenant")).not.toBeInTheDocument();
    expect(from).not.toHaveBeenCalledWith("customers");

    fireEvent.click(enter);
    expect(rpc).toHaveBeenCalledWith("link_my_client_to_organization", {
      p_organization_slug: "barbearia-real",
      p_expected_organization_id: context.organization.id,
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("network interrupted after commit");
    expect(screen.queryByText("conteúdo tenant")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Entrar nesta barbearia" }));
    expect(await screen.findByText("conteúdo tenant")).toBeInTheDocument();
    expect(rpc.mock.calls.filter(([name]) => name === "link_my_client_to_organization")).toHaveLength(2);
    expect(from).toHaveBeenCalledWith("customers");
  });

  it("direciona sessão sem perfil global para completar cadastro sem chamar vínculo", async () => {
    const { rpc } = installProviderClient({ authenticated: true, missingAccount: true });

    render(
      <ConnectedClientProvider initialSlug="barbearia-real">
        <ConnectedClientGate><div>conteúdo tenant</div></ConnectedClientGate>
      </ConnectedClientProvider>,
    );

    expect(await screen.findByText("Complete seus dados de cliente antes de entrar nesta barbearia.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Completar cadastro" })).toHaveAttribute(
      "href",
      "/cliente/entrar?barbearia=barbearia-real&complete=1",
    );
    expect(screen.queryByText("query returned no rows")).not.toBeInTheDocument();
    expect(rpc.mock.calls.some(([name]) => name === "link_my_client_to_organization")).toBe(false);
  });

  it("troca slug legado pelo slug canônico retornado no contexto público", async () => {
    const { rpc } = installProviderClient({ authenticated: false, canonicalSlug: "cutclub" });
    window.history.replaceState(null, "", "/cliente/agendar?barbearia=barbershop");

    render(
      <ConnectedClientProvider initialSlug="barbershop">
        <ConnectedClientGate><div>contexto canônico</div></ConnectedClientGate>
      </ConnectedClientProvider>,
    );

    expect(await screen.findByText("contexto canônico")).toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toBe("?barbearia=cutclub"));
    expect(rpc).toHaveBeenCalledWith("get_public_booking_context", {
      p_organization_slug: "barbershop",
    });
    expect(rpc).toHaveBeenCalledWith("get_public_booking_context", {
      p_organization_slug: "cutclub",
    });
  });

  it("permite confirmar explicitamente um cadastro existente antes de carregar dados tenant", async () => {
    const { from, rpc } = installProviderClient({ authenticated: true, claimRequired: true });

    render(
      <ConnectedClientProvider initialSlug="barbearia-real">
        <ConnectedClientGate><div>conteúdo tenant</div></ConnectedClientGate>
      </ConnectedClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Entrar nesta barbearia" }));
    expect(await screen.findByRole("button", { name: "Confirmar cadastro encontrado" })).toBeEnabled();
    expect(screen.queryByText("conteúdo tenant")).not.toBeInTheDocument();
    expect(from).not.toHaveBeenCalledWith("customers");

    fireEvent.click(screen.getByRole("button", { name: "Confirmar cadastro encontrado" }));
    expect(await screen.findByText("conteúdo tenant")).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("claim_my_existing_customer", {
      p_organization_id: context.organization.id,
      p_customer_id: "customer-1",
    });
    expect(from).toHaveBeenCalledWith("customers");
  });

  it("deduplica confirmações concorrentes do cadastro existente", async () => {
    const { resolveClaim, rpc } = installProviderClient({
      authenticated: true,
      claimRequired: true,
      deferClaim: true,
    });

    render(
      <ConnectedClientProvider initialSlug="barbearia-real">
        <ConnectedClientGate><div>conteúdo tenant</div></ConnectedClientGate>
      </ConnectedClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Entrar nesta barbearia" }));
    const claimButton = await screen.findByRole("button", { name: "Confirmar cadastro encontrado" });
    fireEvent.click(claimButton);
    fireEvent.click(claimButton);
    await waitFor(() => {
      expect(rpc.mock.calls.filter(([name]) => name === "claim_my_existing_customer")).toHaveLength(1);
    });
    resolveClaim();
    expect(await screen.findByText("conteúdo tenant")).toBeInTheDocument();
  });

  it("mantém o tenant bloqueado quando a confirmação do cadastro exige revisão", async () => {
    const { from } = installProviderClient({
      authenticated: true,
      claimRequired: true,
      reviewAfterClaim: true,
    });

    render(
      <ConnectedClientProvider initialSlug="barbearia-real">
        <ConnectedClientGate><div>conteúdo tenant</div></ConnectedClientGate>
      </ConnectedClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Entrar nesta barbearia" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar cadastro encontrado" }));
    expect(await screen.findByText("Vínculo enviado para revisão pela barbearia.")).toBeInTheDocument();
    expect(screen.queryByText("conteúdo tenant")).not.toBeInTheDocument();
    expect(from).not.toHaveBeenCalledWith("customers");
  });

  it("recusa resposta de confirmação para outro cadastro antes de carregar customer", async () => {
    const { from } = installProviderClient({
      authenticated: true,
      claimRequired: true,
      mismatchedClaim: true,
    });

    render(
      <ConnectedClientProvider initialSlug="barbearia-real">
        <ConnectedClientGate><div>conteúdo tenant</div></ConnectedClientGate>
      </ConnectedClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Entrar nesta barbearia" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar cadastro encontrado" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Resposta de confirmação não corresponde ao cadastro selecionado.",
    );
    expect(screen.queryByText("conteúdo tenant")).not.toBeInTheDocument();
    expect(from).not.toHaveBeenCalledWith("customers");
  });

  it("oferece Google ou e-mail com slug preservado sem criar vínculo", async () => {
    const { from, rpc } = installProviderClient({ authenticated: false });

    render(
      <ConnectedClientProvider initialSlug="barbearia-real">
        <ConnectedClientGate>
          <AuthPrompt description="Entre para continuar." />
        </ConnectedClientGate>
      </ConnectedClientProvider>,
    );

    expect(await screen.findByRole("link", { name: "Entrar ou criar conta" })).toHaveAttribute(
      "href",
      "/cliente/entrar?barbearia=barbearia-real",
    );
    expect(screen.getByText("Use Google ou e-mail. Sua sessão é protegida pelo Supabase.")).toBeVisible();
    expect(from).not.toHaveBeenCalled();
    expect(rpc.mock.calls.filter(([name]) => name === "link_my_client_to_organization")).toHaveLength(0);
  });

  it("carrega contexto público enquanto valida sessão", async () => {
    const { resolveAuth, rpc } = installProviderClient({ authenticated: false, deferAuth: true });

    render(
      <ConnectedClientProvider initialSlug="barbearia-real">
        <ConnectedClientGate><div>contexto público pronto</div></ConnectedClientGate>
      </ConnectedClientProvider>,
    );

    expect(await screen.findByText("contexto público pronto")).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("get_public_booking_context", {
      p_organization_slug: "barbearia-real",
    });
    resolveAuth();
  });

  it("expõe conta, organizações e customer quando vínculo já existe", async () => {
    installProviderClient({ authenticated: true, initiallyLinked: true });

    render(
      <ConnectedClientProvider initialSlug="barbearia-real">
        <ConnectedClientGate><ProviderStateProbe /></ConnectedClientGate>
      </ConnectedClientProvider>,
    );

    expect(await screen.findByText("Ana Souza")).toBeInTheDocument();
    expect(screen.getByText("1 barbearia vinculada")).toBeInTheDocument();
    expect(screen.getByText("customer-1")).toBeInTheDocument();
  });

  it("mostra home da barbearia vinculada sem saldo ou carteira", async () => {
    installProviderClient({ authenticated: true, initiallyLinked: true });

    render(
      <ConnectedClientProvider initialSlug="barbearia-real">
        <ConnectedClientHome />
      </ConnectedClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Barbearia Real" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Agendar/u })).toHaveAttribute(
      "href",
      "/cliente/agendar?barbearia=barbearia-real",
    );
    expect(screen.queryByText(/saldo|carteira/iu)).not.toBeInTheDocument();
  });

  it("protege por três minutos o primeiro horário e o libera ao voltar", async () => {
    const { rpc } = installProviderClient({ authenticated: true, initiallyLinked: true });

    render(
      <ConnectedClientProvider initialSlug="barbearia-real">
        <ConnectedBooking />
      </ConnectedClientProvider>,
    );

    fireEvent.click(await screen.findByRole("tab", { name: "Masculino" }));
    fireEvent.click(screen.getAllByRole("button", { name: /Corte/u })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    expect(await screen.findByRole("heading", { name: "Quem vai cuidar de você?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Primeiro horário livre/u }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    expect(await screen.findByRole("heading", { name: "Quando fica melhor?" })).toBeInTheDocument();
    const availableSlot = await screen.findByRole("button", { name: /09:00.*Diego/u });
    fireEvent.click(availableSlot);
    expect(screen.getByRole("status")).toHaveTextContent("Seu atendimento será com Diego");
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    expect(await screen.findByRole("heading", { name: "Revise e agende" })).toBeInTheDocument();
    expect(screen.getByText("Resumo do agendamento")).toBeInTheDocument();
    expect(screen.getAllByText("Diego").length).toBeGreaterThan(0);
    expect(screen.getByRole("list", { name: "Etapa 4 de 4" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("timer")).toHaveTextContent(/Horário protegido por 0[23]:\d{2}/u));
    expect(window.sessionStorage.getItem(
      "los-barberos:booking-hold:barbearia-real:user-1:customer-1",
    )).not.toBeNull();
    expect(window.sessionStorage.getItem("los-barberos:booking-hold:barbearia-real")).toBeNull();
    expect(rpc).toHaveBeenCalledWith("create_customer_booking_hold", expect.objectContaining({
      p_organization_id: context.organization.id,
      p_customer_id: "customer-1",
      p_barber_id: "barber-1",
      p_starts_at: "2026-08-10T12:00:00Z",
    }));

    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
    expect(await screen.findByRole("heading", { name: "Escolha o horário" })).toBeInTheDocument();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("release_customer_booking_hold", {
      p_appointment_id: "appointment-hold-1",
    }));
  });

  it("mantém barbeiro e horário escolhidos na fila ao selecionar o serviço", async () => {
    installProviderClient({ authenticated: true, initiallyLinked: true });
    window.history.replaceState(null, "", "/cliente/agendar?barbearia=barbearia-real&barbeiro=barber-1&horario=2026-08-10T12:00:00Z");

    render(
      <ConnectedClientProvider initialSlug="barbearia-real">
        <ConnectedBooking />
      </ConnectedClientProvider>,
    );

    fireEvent.click(await screen.findByRole("tab", { name: "Masculino" }));
    fireEvent.click(screen.getAllByRole("button", { name: /Corte/u })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    const selectedBarber = await screen.findByRole("button", { name: /Diego/u });
    expect(selectedBarber).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    expect(await screen.findByRole("heading", { name: "Quando fica melhor?" })).toBeInTheDocument();
    await waitFor(() => expect(authMocks.client?.rpc).toHaveBeenCalledWith("get_available_slots", expect.objectContaining({
      p_barber_id: "barber-1",
      p_local_date: "2026-08-10",
    })));
  });

  it("atualiza horários quando outro cliente vence a disputa", async () => {
    const { rpc } = installProviderClient({
      authenticated: true,
      initiallyLinked: true,
      bookingHoldConflict: true,
    });

    render(
      <ConnectedClientProvider initialSlug="barbearia-real">
        <ConnectedBooking />
      </ConnectedClientProvider>,
    );

    fireEvent.click(await screen.findByRole("tab", { name: "Masculino" }));
    fireEvent.click(screen.getAllByRole("button", { name: /Corte/u })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByRole("heading", { name: "Quem vai cuidar de você?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Primeiro horário livre/u }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByRole("heading", { name: "Quando fica melhor?" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /09:00.*Diego/u }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Este horário está sendo finalizado por outro cliente. Atualizamos os horários disponíveis.",
    );
    expect(screen.getByRole("heading", { name: "Escolha o horário" })).toBeInTheDocument();
    await waitFor(() => expect(
      rpc.mock.calls.filter(([name]) => name === "get_available_slots_for_date").length,
    ).toBeGreaterThanOrEqual(2));
  });

  it("libera e atualiza a agenda quando os três minutos terminam", async () => {
    const { rpc } = installProviderClient({
      authenticated: true,
      initiallyLinked: true,
      bookingHoldExpiresInMs: 50,
    });

    render(
      <ConnectedClientProvider initialSlug="barbearia-real">
        <ConnectedBooking />
      </ConnectedClientProvider>,
    );

    fireEvent.click(await screen.findByRole("tab", { name: "Masculino" }));
    fireEvent.click(screen.getAllByRole("button", { name: /Corte/u })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.click(await screen.findByRole("button", { name: /Primeiro horário livre/u }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.click(await screen.findByRole("button", { name: /09:00.*Diego/u }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    expect(await screen.findByRole("heading", { name: "Revise e agende" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(
      "O tempo para concluir terminou. Escolha o horário novamente.",
    ), { timeout: 2_500 });
    expect(screen.getByRole("heading", { name: "Escolha o horário" })).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("release_customer_booking_hold", {
      p_appointment_id: "appointment-hold-1",
    });
  });

  it("salva o perfil global e mantém o e-mail sob gestão da autenticação", async () => {
    const { rpc } = installProviderClient({ authenticated: true, initiallyLinked: true });

    render(
      <ConnectedClientProvider initialSlug="barbearia-real">
        <ConnectedProfile />
      </ConnectedClientProvider>,
    );

    expect(await screen.findByDisplayValue("ana@example.com")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Nome completo"), { target: { value: "Ana Atualizada" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar dados" }));

    await waitFor(() => expect(rpc).toHaveBeenCalledWith("upsert_my_client_account", {
      p_full_name: "Ana Atualizada",
      p_phone_e164: "+5511999999999",
      p_birth_date: "1990-02-10",
      p_terms_policy_version: "client-access-2026-08",
    }));
    expect(rpc.mock.calls.some(([name]) => name === "upsert_my_customer")).toBe(false);
  });

  it("deduplica confirmações concorrentes do mesmo slug", async () => {
    const { resolveLink, rpc } = installProviderClient({ authenticated: true, deferLink: true });

    render(
      <ConnectedClientProvider initialSlug="barbearia-real">
        <ConcurrentLinkProbe />
      </ConnectedClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("status", { name: "status do vínculo" })).toHaveTextContent("UNLINKED");
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar duas vezes" }));
    await waitFor(() => {
      expect(rpc.mock.calls.filter(([name]) => name === "link_my_client_to_organization")).toHaveLength(1);
    });
    resolveLink();
    await waitFor(() => {
      expect(screen.getByRole("status", { name: "status do vínculo" })).toHaveTextContent("LINKED");
    });
  });

  it("recusa resposta de vínculo de outro tenant antes de carregar customer", async () => {
    const { from } = installProviderClient({ authenticated: true, mismatchedLink: true });

    render(
      <ConnectedClientProvider initialSlug="barbearia-real">
        <ConnectedClientGate><div>conteúdo tenant</div></ConnectedClientGate>
      </ConnectedClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Entrar nesta barbearia" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Resposta de vínculo não corresponde à barbearia selecionada.",
    );
    expect(screen.queryByText("conteúdo tenant")).not.toBeInTheDocument();
    expect(from).not.toHaveBeenCalledWith("customers");
  });

  it("redireciona slug público para login do cliente sem criar vínculo", async () => {
    await PublicBarbershopPage({ params: Promise.resolve({ slug: "barbearia real" }) });

    expect(authMocks.redirect).toHaveBeenCalledWith("/cliente/entrar?barbearia=barbearia%20real");
  });

  it("redireciona identificador público para login preservando o vínculo pendente", async () => {
    await PublicBarbershopPage({ params: Promise.resolve({ slug: "00000000-0000-4000-8000-000000000001" }) });

    expect(authMocks.redirect).toHaveBeenCalledWith("/cliente/entrar?booking=00000000-0000-4000-8000-000000000001");
  });

  it("separa entrar de criar conta e oferece Google nos dois modos", () => {
    render(<ClientAuthForm initialSlug="barbearia-real" initialNext="/cliente/agendar" />);

    expect(screen.getByRole("heading", { name: "Acesse sua barbearia" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Entrar" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Continuar com Google" })).toBeEnabled();

    fireEvent.click(screen.getByRole("tab", { name: "Criar conta" }));

    expect(screen.getByLabelText("Nome completo")).toBeRequired();
    expect(screen.getByLabelText("Telefone (E.164)")).toBeRequired();
    expect(screen.getByLabelText("Data de nascimento")).toBeRequired();
    expect(screen.getByLabelText("Data de nascimento")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("Data de nascimento")).toHaveAttribute("inputmode", "numeric");
    expect(screen.getByLabelText("Aceito os termos de uso e a política de privacidade")).toBeRequired();
    expect(screen.getByText("Avisos no WhatsApp começam ativos.")).toBeInTheDocument();
  });

  it("inicia Google com callback allowlisted e contexto da barbearia", async () => {
    render(<ClientAuthForm initialSlug="barbearia-real" initialNext="/cliente/agendar" />);

    fireEvent.click(screen.getByRole("button", { name: "Continuar com Google" }));

    await waitFor(() => expect(authMocks.client?.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "http://localhost:3000/auth/callback?next=%2Fcliente%2Fagendar&barbearia=barbearia-real&provider=google",
      },
    }));
  });

  it("preserva o contexto validado do horário ao iniciar Google", async () => {
    render(await ClientEntryPage({
      searchParams: Promise.resolve({
        barbearia: "barbearia-real",
        next: "/cliente/agendar?barbeiro=00000000-0000-4000-8000-000000000002&horario=2026-08-11T13%3A15%3A00.000Z&admin=true",
      }),
    }));

    fireEvent.click(screen.getByRole("button", { name: "Continuar com Google" }));

    await waitFor(() => expect(authMocks.client?.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "http://localhost:3000/auth/callback?next=%2Fcliente%2Fagendar%3Fbarbeiro%3D00000000-0000-4000-8000-000000000002%26horario%3D2026-08-11T13%253A15%253A00.000Z&barbearia=barbearia-real&provider=google",
      },
    }));
  });

  it("abre cadastro somente quando modo público é cadastro", async () => {
    render(await ClientEntryPage({
      searchParams: Promise.resolve({ modo: "cadastro" }),
    }));

    expect(screen.getByRole("form", { name: "Criar conta" })).toBeInTheDocument();
  });

  it("exige WhatsApp, nascimento e termos no primeiro acesso Google", async () => {
    authMocks.client!.from = vi.fn(() => queryResult(null));
    render(
      <ClientAuthForm
        initialSlug="barbearia-real"
        initialNext="/cliente/agendar"
        oauthCompletion
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Validando sua conta Google");
    expect(await screen.findByRole("heading", { name: "Complete seu cadastro" })).toBeInTheDocument();
    expect(screen.getByLabelText("Nome completo")).toHaveValue("Ana Souza");
    expect(screen.getByLabelText("Telefone (E.164)")).toBeRequired();
    expect(screen.getByLabelText("Data de nascimento")).toBeRequired();
    expect(screen.queryByLabelText("E-mail")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Telefone (E.164)"), { target: { value: "47999782545" } });
    fireEvent.change(screen.getByLabelText("Data de nascimento"), { target: { value: "10/02/1990" } });
    fireEvent.click(screen.getByLabelText("Aceito os termos de uso e a política de privacidade"));
    fireEvent.submit(screen.getByRole("form", { name: "Completar cadastro" }));

    await waitFor(() => expect(authMocks.client?.rpc).toHaveBeenCalledWith("upsert_my_client_account", {
      p_full_name: "Ana Souza",
      p_phone_e164: "+5547999782545",
      p_birth_date: "1990-02-10",
      p_terms_policy_version: "client-access-2026-08",
    }));
    expect(authMocks.push).toHaveBeenCalledWith("/cliente/agendar?barbearia=barbearia-real");
  });

  it("revalida o provider depois de concluir cadastro sem voltar ao loop", async () => {
    installProviderClient({
      authenticated: true,
      missingAccount: true,
      accountAvailableAfterUpsert: true,
    });

    render(
      <ConnectedClientProvider initialSlug="barbearia-real">
        <ClientAuthForm initialSlug="barbearia-real" initialNext="/cliente/agendar" oauthCompletion />
        <ConnectedClientGate><div>agenda liberada</div></ConnectedClientGate>
      </ConnectedClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Complete seu cadastro" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Telefone (E.164)"), { target: { value: "47999782545" } });
    fireEvent.change(screen.getByLabelText("Data de nascimento"), { target: { value: "10/02/1990" } });
    fireEvent.click(screen.getByLabelText("Aceito os termos de uso e a política de privacidade"));
    fireEvent.submit(screen.getByRole("form", { name: "Completar cadastro" }));

    expect(await screen.findByRole("button", { name: "Entrar nesta barbearia" })).toBeInTheDocument();
    expect(authMocks.push).toHaveBeenCalledWith("/cliente/agendar?barbearia=barbearia-real");
  });

  it("restaura última barbearia vinculada ao entrar sem slug", async () => {
    installProviderClient({ authenticated: true, initiallyLinked: true, isLast: true });

    render(
      <ConnectedClientProvider>
        <ConnectedClientGate><div>agenda da última barbearia</div></ConnectedClientGate>
      </ConnectedClientProvider>,
    );

    expect(await screen.findByText("agenda da última barbearia")).toBeInTheDocument();
  });

  it("permite visualizar a senha digitada sem alterar o valor", () => {
    render(<ClientAuthForm initialSlug="barbearia-real" initialNext="/cliente/agendar" />);
    const password = screen.getByLabelText("Senha");
    fireEvent.change(password, { target: { value: "Senha#123" } });

    expect(password).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "Mostrar senha" }));
    expect(password).toHaveAttribute("type", "text");
    expect(password).toHaveValue("Senha#123");
    fireEvent.click(screen.getByRole("button", { name: "Ocultar senha" }));
    expect(password).toHaveAttribute("type", "password");
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
    expect(screen.getByRole("status")).toHaveTextContent(
      "Se o cadastro puder ser concluído, enviaremos instruções para seu e-mail.",
    );
  });

  it("normaliza telefone brasileiro sem DDI antes de criar conta", async () => {
    render(<ClientAuthForm initialSlug="barbearia-real" initialNext="/cliente" />);
    fireEvent.click(screen.getByRole("tab", { name: "Criar conta" }));
    fireEvent.change(screen.getByLabelText("Nome completo"), { target: { value: "Ana Souza" } });
    fireEvent.change(screen.getByLabelText("Telefone (E.164)"), { target: { value: "47999782545" } });
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "ana@example.com" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "Senha#123" } });
    fireEvent.change(screen.getByLabelText("Data de nascimento"), { target: { value: "1990-02-10" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(screen.getByRole("form", { name: "Criar conta" }));

    await waitFor(() => expect(authMocks.client?.auth.signUp.mock.calls[0]?.[0].options.data.phone_e164_candidate).toBe("+5547999782545"));
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

  it("usa recovery direto e callback allowlisted no reenvio", async () => {
    render(<ClientAuthForm initialSlug="barbearia-real" initialNext="https://evil.example" />);
    fireEvent.click(screen.getByRole("button", { name: "Esqueci minha senha" }));
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "ana@example.com" } });
    fireEvent.submit(screen.getByRole("form", { name: "Recuperar senha" }));

    await waitFor(() => expect(authMocks.client?.auth.resetPasswordForEmail).toHaveBeenCalledWith("ana@example.com", {
      redirectTo: "http://localhost:3000/cliente/redefinir-senha?barbearia=barbearia-real",
    }));

    fireEvent.click(screen.getByRole("tab", { name: "Criar conta" }));
    fireEvent.click(screen.getByRole("button", { name: "Reenviar confirmação" }));
    await waitFor(() => expect(authMocks.client?.auth.resend).toHaveBeenCalledWith({
      type: "signup",
      email: "ana@example.com",
      options: { emailRedirectTo: "http://localhost:3000/auth/callback?next=%2Fcliente%2Fagendar&barbearia=barbearia-real" },
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

  it.each([
    ["success", null],
    ["existing-account provider error", { message: "User already registered" }],
  ])("keeps signup result neutral for %s", async (_caseName, providerError) => {
    authMocks.client!.auth.signUp.mockResolvedValueOnce({
      data: { user: providerError ? null : { id: "user-1" }, session: null },
      error: providerError,
    });
    render(<ClientAuthForm initialSlug="barbearia-real" initialNext="/cliente" />);
    fireEvent.click(screen.getByRole("tab", { name: "Criar conta" }));
    fireEvent.change(screen.getByLabelText("Nome completo"), { target: { value: "Ana Souza" } });
    fireEvent.change(screen.getByLabelText("Telefone (E.164)"), { target: { value: "+5511999999999" } });
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "ana@example.com" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "Senha#123" } });
    fireEvent.change(screen.getByLabelText("Data de nascimento"), { target: { value: "1990-02-10" } });
    fireEvent.click(screen.getByLabelText("Aceito os termos de uso e a política de privacidade"));
    fireEvent.submit(screen.getByRole("form", { name: "Criar conta" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Se o cadastro puder ser concluído, enviaremos instruções para seu e-mail.",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    ["success", null],
    ["provider error", { message: "account not found" }],
  ])("keeps recovery result neutral for %s", async (_caseName, providerError) => {
    authMocks.client!.auth.resetPasswordForEmail.mockResolvedValueOnce({
      data: {},
      error: providerError,
    });
    render(<ClientAuthForm initialSlug="barbearia-real" initialNext="/cliente" />);
    fireEvent.click(screen.getByRole("button", { name: "Esqueci minha senha" }));
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "nobody@example.com" } });
    fireEvent.submit(screen.getByRole("form", { name: "Recuperar senha" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Se houver uma conta elegível, enviaremos instruções para seu e-mail.",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    ["success", null],
    ["provider error", { message: "account not found" }],
  ])("keeps resend result neutral for %s", async (_caseName, providerError) => {
    authMocks.client!.auth.resend.mockResolvedValueOnce({
      data: {},
      error: providerError,
    });
    render(<ClientAuthForm initialSlug="barbearia-real" initialNext="/cliente" />);
    fireEvent.click(screen.getByRole("tab", { name: "Criar conta" }));
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "nobody@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Reenviar confirmação" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Se houver uma conta pendente, enviaremos nova confirmação.",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([null, "legacy-metadata"])("handles non-object user metadata safely: %s", async (userMetadata) => {
    authMocks.client!.auth.signInWithPassword.mockResolvedValueOnce({
      data: {
        user: { email: "ana@example.com", user_metadata: userMetadata },
        session: { access_token: "session" },
      },
      error: null,
    });
    render(<ClientAuthForm initialSlug="barbearia-real" initialNext="/cliente" />);
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "ana@example.com" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "Senha#123" } });
    fireEvent.submit(screen.getByRole("form", { name: "Entrar" }));

    expect(await screen.findByRole("heading", { name: "Complete seu cadastro" })).toBeInTheDocument();
    expect(authMocks.client?.rpc).not.toHaveBeenCalled();
  });

  it("keeps auth locked until account upsert finishes", async () => {
    let resolveRpc!: (value: { data: string; error: null }) => void;
    authMocks.client!.rpc.mockImplementationOnce(() => new Promise((resolve) => {
      resolveRpc = resolve;
    }));
    render(<ClientAuthForm initialSlug="barbearia-real" initialNext="/cliente" />);
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "ana@example.com" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "Senha#123" } });
    const form = screen.getByRole("form", { name: "Entrar" });
    fireEvent.submit(form);

    await waitFor(() => expect(authMocks.client?.rpc).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "Aguarde…" })).toBeDisabled();
    fireEvent.submit(form);
    expect(authMocks.client?.auth.signInWithPassword).toHaveBeenCalledOnce();
    expect(authMocks.client?.rpc).toHaveBeenCalledOnce();

    resolveRpc({ data: "account-1", error: null });
    await waitFor(() => expect(authMocks.push).toHaveBeenCalledWith("/cliente?barbearia=barbearia-real"));
  });

  it("releases auth lock after a rejected provider promise", async () => {
    authMocks.client!.auth.signInWithPassword.mockRejectedValueOnce(new Error("network"));
    render(<ClientAuthForm initialSlug="barbearia-real" initialNext="/cliente" />);
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "ana@example.com" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "Senha#123" } });
    fireEvent.submit(screen.getByRole("form", { name: "Entrar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível concluir acesso.");
    expect(screen.getByRole("button", { name: "Entrar" })).toBeEnabled();
  });

  it("scrubs PKCE context before a pending recovery exchange, then updates password", async () => {
    window.history.replaceState(
      null,
      "",
      "/cliente/redefinir-senha?code=recovery-code&sb_flow_id=recovery-flow&barbearia=barbearia-real",
    );
    const replaceState = vi.spyOn(window.history, "replaceState");
    let resolveExchange!: (value: {
      data: {
        user: { id: string };
        session: { access_token: string };
        redirectType: "recovery";
      };
      error: null;
    }) => void;
    authMocks.client!.auth.exchangeCodeForSession.mockImplementationOnce(() => new Promise((resolve) => {
      resolveExchange = resolve;
    }));
    const page = await ClientPasswordResetPage({
      searchParams: Promise.resolve({
        code: "recovery-code",
        sb_flow_id: "recovery-flow",
        barbearia: "Barbearia-Real",
      }),
    });
    render(page);

    await waitFor(() => expect(authMocks.client?.auth.exchangeCodeForSession).toHaveBeenCalledWith(
      "recovery-code",
      { flowId: "recovery-flow" },
    ));
    expect(replaceState).toHaveBeenCalledWith(
      null,
      "",
      "/cliente/redefinir-senha?barbearia=barbearia-real",
    );
    expect(replaceState.mock.invocationCallOrder[0]).toBeLessThan(
      authMocks.client!.auth.exchangeCodeForSession.mock.invocationCallOrder[0],
    );
    expect(window.location.href).toBe(
      "http://localhost:3000/cliente/redefinir-senha?barbearia=barbearia-real",
    );
    expect(screen.getByRole("status")).toHaveTextContent("Validando link de recuperação");

    resolveExchange({
      data: {
        user: { id: "user-1" },
        session: { access_token: "recovery-session" },
        redirectType: "recovery",
      },
      error: null,
    });
    const password = await screen.findByLabelText("Nova senha");
    fireEvent.change(password, { target: { value: "NovaSenha#123" } });
    fireEvent.change(screen.getByLabelText("Confirmar nova senha"), { target: { value: "NovaSenha#123" } });
    fireEvent.submit(screen.getByRole("form", { name: "Redefinir senha" }));

    await waitFor(() => expect(authMocks.client?.auth.updateUser).toHaveBeenCalledWith({ password: "NovaSenha#123" }));
    expect(authMocks.push).toHaveBeenCalledWith("/cliente?barbearia=barbearia-real");
  });

  it("rejects weak recovery password before provider mutation", async () => {
    render(<ClientPasswordResetForm initialSlug="barbearia-real" recoveryCode="recovery-code" recoveryFlowId="recovery-flow" />);
    const password = await screen.findByLabelText("Nova senha");
    fireEvent.change(password, { target: { value: "fraca" } });
    fireEvent.change(screen.getByLabelText("Confirmar nova senha"), { target: { value: "fraca" } });
    fireEvent.submit(screen.getByRole("form", { name: "Redefinir senha" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Use uma senha com pelo menos 8 caracteres");
    expect(authMocks.client?.auth.updateUser).not.toHaveBeenCalled();
  });

  it("rejects a common existing session when no recovery code exists", async () => {
    render(<ClientPasswordResetForm initialSlug="barbearia-real" recoveryCode={null} recoveryFlowId={null} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Link inválido ou sessão expirada.");
    expect(screen.queryByRole("form", { name: "Redefinir senha" })).not.toBeInTheDocument();
    expect(authMocks.client?.auth.getSession).not.toHaveBeenCalled();
    expect(authMocks.client?.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("rejects a non-recovery exchange and removes its local session", async () => {
    authMocks.client!.auth.exchangeCodeForSession.mockResolvedValueOnce({
      data: {
        user: { id: "user-1" },
        session: { access_token: "ordinary-session" },
        redirectType: null,
      },
      error: null,
    });
    render(<ClientPasswordResetForm initialSlug="barbearia-real" recoveryCode="ordinary-code" recoveryFlowId="recovery-flow" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Link inválido ou sessão expirada.");
    expect(authMocks.client?.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(screen.queryByRole("form", { name: "Redefinir senha" })).not.toBeInTheDocument();
  });

  it("rejects an expired or invalid recovery code", async () => {
    authMocks.client!.auth.exchangeCodeForSession.mockResolvedValueOnce({
      data: { user: null, session: null, redirectType: null },
      error: { message: "PKCE code expired" },
    });
    render(<ClientPasswordResetForm initialSlug="barbearia-real" recoveryCode="expired-code" recoveryFlowId="recovery-flow" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Link inválido ou sessão expirada.");
    expect(authMocks.client?.auth.signOut).not.toHaveBeenCalled();
  });

  it("rejects duplicated recovery code search params", async () => {
    const page = await ClientPasswordResetPage({
      searchParams: Promise.resolve({
        code: ["first-code", "second-code"],
        barbearia: "barbearia-real",
      }),
    });
    render(page);

    expect(await screen.findByRole("alert")).toHaveTextContent("Link inválido ou sessão expirada.");
    expect(authMocks.client?.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it.each([
    ["without PKCE flow context", undefined],
    ["with empty PKCE flow context", ""],
  ])("rejects a recovery code %s", async (_caseName, sbFlowId) => {
    const page = await ClientPasswordResetPage({
      searchParams: Promise.resolve({
        code: "recovery-code",
        sb_flow_id: sbFlowId,
        barbearia: "barbearia-real",
      }),
    });
    render(page);

    expect(await screen.findByRole("alert")).toHaveTextContent("Link inválido ou sessão expirada.");
    expect(authMocks.client?.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("rejects duplicated tenant context on the recovery page", async () => {
    const page = await ClientPasswordResetPage({
      searchParams: Promise.resolve({
        code: "recovery-code",
        barbearia: ["barbearia-real", "outra-barbearia"],
      }),
    });
    render(page);

    expect(await screen.findByRole("alert")).toHaveTextContent("Link inválido ou sessão expirada.");
    expect(authMocks.client?.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("rejects duplicated PKCE flow context on the recovery page", async () => {
    const page = await ClientPasswordResetPage({
      searchParams: Promise.resolve({
        code: "recovery-code",
        sb_flow_id: ["first-flow", "second-flow"],
        barbearia: "barbearia-real",
      }),
    });
    render(page);

    expect(await screen.findByRole("alert")).toHaveTextContent("Link inválido ou sessão expirada.");
    expect(authMocks.client?.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});
