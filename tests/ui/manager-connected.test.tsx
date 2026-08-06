import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgendaManager } from "@/components/connected-manager/agenda-manager";
import { ManagerDashboard } from "@/components/connected-manager/manager-dashboard";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const organization = {
  id: "org-1",
  name: "Barbearia Real",
  slug: "barbearia-real",
  timezone: "America/Sao_Paulo",
  currency: "BRL",
  deposit_bps: 3000,
  cancellation_lead_minutes: 1440,
  slot_interval_minutes: 15,
  hold_duration_minutes: 10,
  commission_frequency: "MONTHLY" as const,
  whatsapp_phone_number_id: null,
};
const customer = { id: "customer-1", organization_id: "org-1", full_name: "Cliente Real", phone_e164: "+5511999999999", email: null, birth_date: null, notes: null, active: true, created_at: new Date().toISOString() };
const barber = { id: "barber-1", organization_id: "org-1", location_id: "location-1", display_name: "Barbeiro Real", bio: null, avatar_url: null, active: true };
const service = { id: "service-1", organization_id: "org-1", name: "Corte Real", description: null, price_cents: 5000, duration_minutes: 30, active: true, sort_order: 0, audiences: ["MASCULINO"] as const };

describe("connected manager UI", () => {
  beforeEach(() => { cleanup(); refresh.mockReset(); });

  it("renders only tenant records on the dashboard", () => {
    render(<ManagerDashboard organizationId="org-1" billingStatus="ACTIVE" organization={organization} appointments={[]} customers={[customer]} barbers={[barber]} financial={[]} openPayouts={[]} />);
    expect(screen.getByText(/Barbearia Real/)).toBeInTheDocument();
    expect(screen.getByText("Dia livre")).toBeInTheDocument();
    expect(screen.queryByText("Guilherme")).not.toBeInTheDocument();
    expect(screen.queryByText("R$ 1.845")).not.toBeInTheDocument();
  });

  it("blocks only new booking and rescheduling while existing operations stay visible", () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    const futureStart = new Date(`${today}T14:00:00-03:00`);
    const futureEnd = new Date(futureStart.getTime() + 30 * 60_000);
    render(<AgendaManager
      organizationId="org-1"
      billingStatus="BLOCKED"
      organization={organization}
      customers={[customer]}
      barbers={[barber]}
      services={[service]}
      packages={[]}
      barberServices={[{ organization_id: "org-1", barber_id: barber.id, service_id: service.id, active: true }]}
      financial={[{ appointment_id: "appointment-1", captured_cents: 0, refunded_cents: 0, net_paid_cents: 0, outstanding_cents: 5000, financial_status: "UNPAID" }]}
      appointments={[{ id: "appointment-1", organization_id: "org-1", customer_id: customer.id, barber_id: barber.id, status: "CONFIRMED", source: "MANAGER", service_period: `[${futureStart.toISOString()},${futureEnd.toISOString()})`, payment_mode: "COUNTER", currency: "BRL", total_cents_snapshot: 5000, notes: null, schedule_override_reason: null, created_at: new Date().toISOString() }]}
    />);
    expect(screen.getByRole("button", { name: "Novo agendamento" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Abrir Cliente Real" }));
    expect(screen.getByRole("button", { name: "Reagendar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Iniciar" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "No-show" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeEnabled();
  });

  it("permite buscar um cliente real antes de criar o agendamento", () => {
    render(<AgendaManager
      organizationId="org-1"
      billingStatus="ACTIVE"
      organization={organization}
      customers={[customer]}
      barbers={[barber]}
      services={[service]}
      packages={[]}
      barberServices={[]}
      financial={[]}
      appointments={[]}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Novo agendamento" }));
    fireEvent.change(screen.getByPlaceholderText("Buscar por nome ou telefone"), { target: { value: "Real" } });

    expect(screen.getByRole("button", { name: "Selecionar Cliente Real" })).toBeInTheDocument();
  });

  it("oferece cadastro rápido quando não encontra cliente real", () => {
    render(<AgendaManager organizationId="org-1" billingStatus="ACTIVE" organization={organization} customers={[customer]} barbers={[barber]} services={[service]} packages={[]} barberServices={[]} financial={[]} appointments={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Novo agendamento" }));
    fireEvent.change(screen.getByPlaceholderText("Buscar por nome ou telefone"), { target: { value: "Novo cliente" } });
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar novo cliente" }));

    expect(screen.getByLabelText("Nome do novo cliente")).toBeInTheDocument();
  });

  it("exibe o nome snapshot real do atendimento no calendário", () => {
    const start = new Date("2026-08-07T14:00:00.000Z");
    const end = new Date("2026-08-07T14:30:00.000Z");
    render(<AgendaManager
      organizationId="org-1"
      billingStatus="ACTIVE"
      organization={organization}
      customers={[customer]}
      barbers={[barber]}
      services={[service]}
      packages={[]}
      barberServices={[]}
      financial={[]}
      appointments={[{ id: "appointment-calendar", organization_id: "org-1", customer_id: customer.id, barber_id: barber.id, status: "CONFIRMED", source: "MANAGER", service_period: `[${start.toISOString()},${end.toISOString()})`, payment_mode: "COUNTER", currency: "BRL", total_cents_snapshot: 5000, notes: null, schedule_override_reason: null, created_at: new Date().toISOString() }]}
      appointmentItems={[{ id: "item-1", organization_id: "org-1", appointment_id: "appointment-calendar", service_name_snapshot: "Corte Real", position: 0 }]}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Selecionar data" }));
    fireEvent.change(screen.getByLabelText("Selecionar data da agenda"), { target: { value: "2026-08-07" } });
    expect(screen.getByText("Corte Real")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Semana" }));
    expect(screen.getByText("Corte Real")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mês" }));
    expect(screen.getByText("1 reserva")).toBeInTheDocument();
  });

  it("alterna entre calendário diário, semanal e mensal", () => {
    render(<AgendaManager organizationId="org-1" billingStatus="ACTIVE" organization={organization} customers={[customer]} barbers={[barber]} services={[service]} packages={[]} barberServices={[]} financial={[]} appointments={[]} appointmentItems={[]} />);

    expect(screen.getByRole("region", { name: "Agenda diária" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Semana" }));
    expect(screen.getByRole("region", { name: "Agenda semanal" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mês" }));
    expect(screen.getByRole("region", { name: "Agenda mensal" })).toBeInTheDocument();
  });

  it("abre novo agendamento em uma tela secundária modal", () => {
    render(<AgendaManager organizationId="org-1" billingStatus="ACTIVE" organization={organization} customers={[customer]} barbers={[barber]} services={[service]} packages={[]} barberServices={[]} financial={[]} appointments={[]} appointmentItems={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Novo agendamento" }));
    expect(screen.getByRole("dialog", { name: "Novo agendamento" })).toBeInTheDocument();
    expect(screen.getByText("Reserve um horário")).toBeInTheDocument();
  });
});
