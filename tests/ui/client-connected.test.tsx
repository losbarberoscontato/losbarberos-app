import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ConnectedClientProvider } from "@/components/connected-client/context";
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
    render(<ConnectedClientProvider><ConnectedClientGate><div>conteúdo privado</div></ConnectedClientGate></ConnectedClientProvider>);
    expect(await screen.findByRole("heading", { name: "Qual barbearia?" })).toBeInTheDocument();
    expect(screen.queryByText("conteúdo privado")).not.toBeInTheDocument();
  });
});
