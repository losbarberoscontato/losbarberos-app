import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgendaManager } from "@/components/connected-manager/agenda-manager";
import { CustomersManager } from "@/components/connected-manager/customers-manager";
import { ManagerDashboard } from "@/components/connected-manager/manager-dashboard";
import { SettingsManager } from "@/components/connected-manager/settings-manager";
import { TeamManager } from "@/components/connected-manager/team-manager";

const refresh = vi.fn();
const mutationMocks = vi.hoisted(() => ({ update: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })) })) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/connected-manager/mutation-utils", () => ({
  connectedClient: () => ({ from: () => ({ update: mutationMocks.update }) }),
  assertResult: (result: unknown) => result,
  runMutation: async (_setMessage: unknown, mutation: () => Promise<unknown>) => { await mutation(); return true; },
}));

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
  queue_public_id: "00000000-0000-4000-8000-000000000001",
};
const customer = { id: "customer-1", organization_id: "org-1", auth_user_id: null, full_name: "Cliente Real", phone_e164: "+5511999999999", email: null, birth_date: null, notes: null, active: true, inactivation_reason: null, inactivated_at: null, created_at: new Date().toISOString() };
const barber = { id: "barber-1", organization_id: "org-1", location_id: "location-1", display_name: "Barbeiro Real", bio: null, avatar_url: null, whatsapp_e164: null, active: true };
const service = { id: "service-1", organization_id: "org-1", name: "Corte Real", description: null, price_cents: 5000, duration_minutes: 30, active: true, sort_order: 0, audiences: ["MASCULINO"] as const };

describe("connected manager UI", () => {
  beforeEach(() => { cleanup(); refresh.mockReset(); mutationMocks.update.mockClear(); });

  it("renders only tenant records on the dashboard", () => {
    render(<ManagerDashboard organizationId="org-1" billingStatus="ACTIVE" organization={organization} appointments={[]} customers={[customer]} barbers={[barber]} financial={[]} openPayouts={[]} />);
    expect(screen.getByText(/Barbearia Real/)).toBeInTheDocument();
    expect(screen.getByText("Dia livre")).toBeInTheDocument();
    expect(screen.queryByText("Guilherme")).not.toBeInTheDocument();
    expect(screen.queryByText("R$ 1.845")).not.toBeInTheDocument();
  });

  it("normaliza e salva o WhatsApp do profissional", async () => {
    render(<TeamManager
      organizationId="org-1"
      billingStatus="ACTIVE"
      timezone="America/Sao_Paulo"
      locations={[{ id: "location-1", organization_id: "org-1", name: "Unidade principal", address: {}, active: true }]}
      barbers={[barber]}
      services={[]}
      barberServices={[]}
      workIntervals={[]}
      exceptions={[]}
      commissionRules={[]}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    fireEvent.change(screen.getByLabelText(/WhatsApp do profissional/), { target: { value: "47 99978-2545" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(mutationMocks.update).toHaveBeenCalledWith(expect.objectContaining({
      whatsapp_e164: "+5547999782545",
    })));
  });

  it("exibe a resposta do cliente pelo WhatsApp na agenda do gestor", () => {
    const start = new Date(Date.now() + 60 * 60_000);
    const end = new Date(start.getTime() + 30 * 60_000);
    render(<ManagerDashboard organizationId="org-1" billingStatus="ACTIVE" organization={organization} customers={[customer]} barbers={[barber]} financial={[]} openPayouts={[]} appointments={[{
      id: "appointment-whatsapp", organization_id: "org-1", customer_id: customer.id, barber_id: barber.id,
      status: "CONFIRMED", whatsapp_response_status: "CONFIRMED_BY_WHATSAPP", source: "CUSTOMER",
      service_period: `[${start.toISOString()},${end.toISOString()})`, payment_mode: "COUNTER", currency: "BRL",
      total_cents_snapshot: 5000, notes: null, schedule_override_reason: null, created_at: new Date().toISOString(),
    }]} />);

    expect(screen.getByText("Confirmado pelo WhatsApp")).toBeInTheDocument();
  });

  it("prepares an isolated A4 sheet to print the queue QR", () => {
    render(<SettingsManager
      organizationId="org-1"
      billingStatus="ACTIVE"
      organization={organization}
      locations={[]}
      merchant={null}
      subscription={null}
    />);

    const sheet = screen.getByLabelText("Folha de impressão da fila presencial");
    expect(within(sheet).getByRole("heading", { name: "Barbearia Real" })).toBeInTheDocument();
    expect(within(sheet).getByText("Chegou agora? Verifique a fila de espera e faça sua reserva")).toBeInTheDocument();
    expect(within(sheet).getByText("Agradecemos sua preferência")).toBeInTheDocument();
    expect(within(sheet).getByLabelText("Logo Los Barberos")).toBeInTheDocument();
    expect(within(sheet).getByTestId("queue-print-qr")).toHaveAttribute("width", "520");
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

  it("nÃ£o mostra cliente inativo na busca de novo agendamento", () => {
    const inactiveCustomer = { ...customer, id: "customer-inactive", full_name: "Cliente Inativo", active: false };
    render(<AgendaManager organizationId="org-1" billingStatus="ACTIVE" organization={organization} customers={[customer, inactiveCustomer]} barbers={[barber]} services={[service]} packages={[]} barberServices={[]} financial={[]} appointments={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Novo agendamento" }));
    fireEvent.change(screen.getByPlaceholderText("Buscar por nome ou telefone"), { target: { value: "Cliente" } });
    expect(screen.getByRole("button", { name: "Selecionar Cliente Real" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Selecionar Cliente Inativo" })).not.toBeInTheDocument();
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

  it("mostra linha da hora atual somente no dia atual e alinhada a cinco minutos", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-07T12:47:00.000Z"));
    try {
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
        appointmentItems={[]}
      />);

      expect(screen.getByLabelText("Hora atual: 09:45")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
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

  it("abre cadastro e edição de cliente em modal", () => {
    render(<CustomersManager organizationId="org-1" billingStatus="ACTIVE" customers={[customer]} appointments={[]} appointmentItems={[]} financial={[]} barbers={[]} statusEvents={[]} />);

    expect(screen.getByText("Recebe Whats Aut.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Novo cliente" }));
    expect(screen.getByRole("dialog", { name: "Novo cliente" })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog", { name: "Novo cliente" })).getByRole("button", { name: "Fechar" }));

    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    expect(screen.getByRole("dialog", { name: "Editar cliente" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Cliente Real")).toBeInTheDocument();
  });

  it("informa quando cliente desativou WhatsApp automático", () => {
    const optedOutCustomer = { ...customer, whatsapp_transactional_opted_out: true };
    render(<CustomersManager organizationId="org-1" billingStatus="ACTIVE" customers={[optedOutCustomer]} appointments={[]} appointmentItems={[]} financial={[]} barbers={[]} statusEvents={[]} />);

    expect(screen.getByText("Não Recebe Whats Aut.")).toBeInTheDocument();
    expect(screen.queryByText("Recebe Whats Aut.")).not.toBeInTheDocument();
  });

  it("bloqueia dados canônicos de cliente vinculado e preserva observações do gestor", async () => {
    const linkedCustomer = { ...customer, auth_user_id: "client-auth-user", notes: "Preferência antiga" };
    render(<CustomersManager organizationId="org-1" billingStatus="ACTIVE" customers={[linkedCustomer]} appointments={[]} appointmentItems={[]} financial={[]} barbers={[]} statusEvents={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    expect(screen.getByText(/Dados controlados pelo cliente/u)).toBeInTheDocument();
    expect(screen.getByLabelText("Nome completo")).toBeDisabled();
    expect(screen.getByLabelText("Telefone")).toBeDisabled();
    expect(screen.getByLabelText("E-mail")).toBeDisabled();
    expect(screen.getByLabelText("Nascimento (opcional)")).toBeDisabled();
    const notes = screen.getByLabelText("Observações");
    expect(notes).toBeEnabled();
    fireEvent.change(notes, { target: { value: "Prefere atendimento cedo" } });
    fireEvent.submit(screen.getByRole("dialog", { name: "Editar cliente" }));

    await waitFor(() => expect(mutationMocks.update).toHaveBeenCalledWith({ notes: "Prefere atendimento cedo" }));
  });

  it("exige motivo para inativar e filtra ativos e inativos", () => {
    const inactiveCustomer = { ...customer, id: "customer-inactive", full_name: "Cliente Inativo", active: false, inactivation_reason: "Perda de contato", inactivated_at: new Date().toISOString() };
    render(<CustomersManager organizationId="org-1" billingStatus="ACTIVE" customers={[customer, inactiveCustomer]} appointments={[]} appointmentItems={[]} financial={[]} barbers={[]} statusEvents={[]} />);
    const panel = screen.getByRole("heading", { name: "Base de clientes" }).closest("section");
    if (!panel) throw new Error("Clientes panel missing");
    expect(within(panel).getByRole("combobox", { name: "Filtro de clientes" })).toHaveValue("ACTIVE");
    expect(within(panel).getByText("Cliente Real")).toBeInTheDocument();
    expect(within(panel).queryByText("Cliente Inativo")).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Inativar" }));
    expect(screen.getByRole("dialog", { name: "Inativar cliente" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar inativação" })).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: "Motivo da inativação" }), { target: { value: "OTHER" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Outro motivo" }), { target: { value: "Cliente mudou de rotina" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar inativação" }));
    expect(mutationMocks.update).toHaveBeenCalled();
    fireEvent.change(within(panel).getByRole("combobox", { name: "Filtro de clientes" }), { target: { value: "INACTIVE" } });
    expect(within(panel).getByText("Cliente Inativo")).toBeInTheDocument();
    expect(within(panel).queryByText("Cliente Real")).not.toBeInTheDocument();
  });

  it("exibe última visita e histórico de agendamentos do cliente", () => {
    const start = new Date(Date.now() - 53 * 86_400_000);
    const end = new Date(start.getTime() + 30 * 60_000);
    const appointment = { id: "appointment-history", organization_id: "org-1", customer_id: customer.id, barber_id: barber.id, status: "COMPLETED" as const, source: "MANAGER", service_period: `[${start.toISOString()},${end.toISOString()})`, payment_mode: "COUNTER", currency: "BRL", total_cents_snapshot: 5000, notes: null, schedule_override_reason: null, created_at: start.toISOString() };

    render(<CustomersManager organizationId="org-1" billingStatus="ACTIVE" customers={[customer]} appointments={[appointment]} appointmentItems={[{ id: "item-history", organization_id: "org-1", appointment_id: appointment.id, service_name_snapshot: "Corte Real", position: 0 }]} financial={[{ appointment_id: appointment.id, captured_cents: 5000, refunded_cents: 0, net_paid_cents: 5000, outstanding_cents: 0, financial_status: "PAID" }]} barbers={[barber]} statusEvents={[{ id: 1, organization_id: "org-1", appointment_id: appointment.id, reason: "appointment_rescheduled", created_at: start.toISOString() }]} />);

    expect(screen.getByText(/Última visita deste cliente foi há \d+ dias/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ver Agendamentos" }));
    expect(screen.getByRole("dialog", { name: "Agendamentos de Cliente Real" })).toBeInTheDocument();
    expect(screen.getByText("Corte Real")).toBeInTheDocument();
    expect(screen.getByText("Atendimento feito")).toBeInTheDocument();
    expect(screen.getByText("R$ 50,00")).toBeInTheDocument();
    expect(screen.getByText("Barbeiro Real")).toBeInTheDocument();
  });

  it("mantém atendimento concluído no histórico mesmo se o intervalo estiver à frente do relógio", () => {
    const start = new Date(Date.now() + 60_000);
    const appointment = { id: "appointment-completed-clock-skew", organization_id: "org-1", customer_id: customer.id, barber_id: barber.id, status: "COMPLETED" as const, source: "MANAGER", service_period: `[${start.toISOString()},${new Date(start.getTime() + 30 * 60_000).toISOString()})`, payment_mode: "COUNTER", currency: "BRL", total_cents_snapshot: 5000, notes: null, schedule_override_reason: null, created_at: new Date().toISOString() };

    render(<CustomersManager organizationId="org-1" billingStatus="ACTIVE" customers={[customer]} appointments={[appointment]} appointmentItems={[{ id: "item-clock-skew", organization_id: "org-1", appointment_id: appointment.id, service_name_snapshot: "Corte com horário ajustado", position: 0 }]} financial={[{ appointment_id: appointment.id, captured_cents: 5000, refunded_cents: 0, net_paid_cents: 5000, outstanding_cents: 0, financial_status: "PAID" }]} barbers={[barber]} statusEvents={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Ver Agendamentos" }));
    expect(screen.getByText("Corte com horário ajustado")).toBeInTheDocument();
  });
  it("exibe somente atendimentos concluidos com pagamento no historico", () => {
    const paidStart = new Date("2026-08-01T14:00:00.000Z");
    const unpaidStart = new Date("2026-08-02T14:00:00.000Z");
    const confirmedStart = new Date("2026-08-03T14:00:00.000Z");
    const paid = { id: "appointment-paid", organization_id: "org-1", customer_id: customer.id, barber_id: barber.id, status: "COMPLETED" as const, source: "MANAGER", service_period: `[${paidStart.toISOString()},${new Date(paidStart.getTime() + 30 * 60_000).toISOString()})`, payment_mode: "COUNTER", currency: "BRL", total_cents_snapshot: 5000, notes: null, schedule_override_reason: null, created_at: paidStart.toISOString() };
    const unpaid = { ...paid, id: "appointment-unpaid", service_period: `[${unpaidStart.toISOString()},${new Date(unpaidStart.getTime() + 30 * 60_000).toISOString()})`, created_at: unpaidStart.toISOString() };
    const confirmed = { ...paid, id: "appointment-confirmed", status: "CONFIRMED" as const, service_period: `[${confirmedStart.toISOString()},${new Date(confirmedStart.getTime() + 30 * 60_000).toISOString()})`, created_at: confirmedStart.toISOString() };
    render(<CustomersManager organizationId="org-1" billingStatus="ACTIVE" customers={[customer]} appointments={[paid, unpaid, confirmed]} appointmentItems={[
      { id: "item-paid", organization_id: "org-1", appointment_id: paid.id, service_name_snapshot: "Pago concluido", position: 0 },
      { id: "item-unpaid", organization_id: "org-1", appointment_id: unpaid.id, service_name_snapshot: "Concluido sem pagamento", position: 0 },
      { id: "item-confirmed", organization_id: "org-1", appointment_id: confirmed.id, service_name_snapshot: "Confirmado pago", position: 0 },
    ]} financial={[
      { appointment_id: paid.id, captured_cents: 5000, refunded_cents: 0, net_paid_cents: 5000, outstanding_cents: 0, financial_status: "PAID" },
      { appointment_id: unpaid.id, captured_cents: 0, refunded_cents: 0, net_paid_cents: 0, outstanding_cents: 5000, financial_status: "UNPAID" },
      { appointment_id: confirmed.id, captured_cents: 5000, refunded_cents: 0, net_paid_cents: 5000, outstanding_cents: 0, financial_status: "PAID" },
    ]} barbers={[barber]} statusEvents={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Ver Agendamentos" }));
    expect(screen.getByText("Pago concluido")).toBeInTheDocument();
    expect(screen.queryByText("Concluido sem pagamento")).not.toBeInTheDocument();
    expect(screen.queryByText("Confirmado pago")).not.toBeInTheDocument();
  });
});
