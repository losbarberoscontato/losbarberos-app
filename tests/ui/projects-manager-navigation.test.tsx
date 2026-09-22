import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectsManager } from "@/components/connected-manager/projects-manager";

const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const data = {
  organizationId: "org-1",
  enabled: true,
  retentionStatus: "NONE" as const,
  projects: [{ id: "project-1", organization_id: "org-1", name: "Projeto Natal 2026", description: "Jornada de fim de ano", status: "PUBLISHED" as const, starts_on: "2026-10-01", sales_close_on: null, ends_on: "2026-12-31", goal_contracts: 10, created_at: "2026-09-15T00:00:00.000Z" }],
  packages: [],
  steps: [],
  engagements: [],
  installments: [],
  customers: [],
  services: [],
  barbers: [{ id: "barber-1", display_name: "Alef Gonçalves" }],
  packageBarbers: [],
  costItems: [],
  kanbanBoards: [
    { id: "board-proposal", organization_id: "org-1", project_id: "project-1", name: "Aguardando aceite", system_key: "PROPOSAL" as const, position: 1, responsible_barber_id: "barber-1", active: true, created_at: "2026-09-15T00:00:00.000Z" },
    { id: "board-active", organization_id: "org-1", project_id: "project-1", name: "Em execução", system_key: "ACTIVE" as const, position: 2, responsible_barber_id: "barber-1", active: true, created_at: "2026-09-15T00:00:00.000Z" },
    { id: "board-completed", organization_id: "org-1", project_id: "project-1", name: "Concluídas", system_key: "COMPLETED" as const, position: 3, responsible_barber_id: "barber-1", active: true, created_at: "2026-09-15T00:00:00.000Z" },
    { id: "board-canceled", organization_id: "org-1", project_id: "project-1", name: "Canceladas", system_key: "CANCELED" as const, position: 4, responsible_barber_id: "barber-1", active: true, created_at: "2026-09-15T00:00:00.000Z" },
  ],
};

const kanbanData = {
  ...data,
  customers: [{ id: "customer-1", full_name: "Cliente Teste", phone_e164: null, email: null }],
  engagements: [{ id: "engagement-1", organization_id: "org-1", project_id: "project-1", customer_id: "customer-1", package_id: "package-1", kanban_board_id: "board-proposal", status: "PROPOSAL" as const, contracted_cents: 15000, proposal_sent_at: "2026-09-15T00:00:00.000Z", accepted_at: null, created_at: "2026-09-15T00:00:00.000Z" }],
};

const editableProjectData = {
  ...data,
  packages: [{ id: "package-1", organization_id: "org-1", project_id: "project-1", name: "Experiência", description: "Planejamento e revisão", price_cents: 15000, sessions_count: 5, duration_minutes: 60, fixed_cost_per_hour_cents: 0, extra_costs_cents: 0, extra_costs_description: null, tax_rate_bps: 0, card_rate_bps: 0, profit_margin_bps: 5000, deposit_cents: 0, suggested_price_cents: 15000, sort_order: 1, active: true }],
};

const contractData = {
  ...data,
  customers: [{ id: "customer-1", full_name: "Cliente Teste", phone_e164: null, email: null }],
  packages: [{ id: "package-1", organization_id: "org-1", project_id: "project-1", name: "Experiência", description: null, price_cents: 15000, sessions_count: 5, duration_minutes: 60, fixed_cost_per_hour_cents: 0, extra_costs_cents: 0, extra_costs_description: null, tax_rate_bps: 0, card_rate_bps: 0, profit_margin_bps: 5000, deposit_cents: 5000, suggested_price_cents: 15000, sort_order: 1, active: true }],
  engagements: [{ id: "engagement-1", organization_id: "org-1", project_id: "project-1", customer_id: "customer-1", package_id: "package-1", kanban_board_id: "board-active", status: "ACTIVE" as const, contracted_cents: 15000, proposal_sent_at: "2026-09-14T00:00:00.000Z", accepted_at: "2026-09-15T12:00:00.000Z", created_at: "2026-09-14T00:00:00.000Z" }],
  installments: [
    { id: "installment-entry", engagement_id: "engagement-1", installment_number: 0, due_on: "2026-09-15", amount_cents: 5000, status: "PAID" as const },
    { id: "installment-1", engagement_id: "engagement-1", installment_number: 1, due_on: "2026-09-15", amount_cents: 5000, status: "PAID" as const },
    { id: "installment-2", engagement_id: "engagement-1", installment_number: 2, due_on: "2026-10-15", amount_cents: 5000, status: "OPEN" as const },
  ],
};

const contractWithSessionsData = {
  ...contractData,
  projectSessions: [{
    id: "session-1",
    organization_id: "org-1",
    engagement_id: "engagement-1",
    session_number: 1,
    status: "BOOKED" as const,
    appointment_id: "appointment-1",
    service_id: "service-1",
    barber_id: "barber-1",
    appointment: { id: "appointment-1", status: "CONFIRMED", service_period: "[2026-11-25 14:30:00+00,2026-11-25 15:30:00+00)", barber_id: "barber-1", source: "PROJECT" },
  }],
};

describe("projects navigation", () => {
  afterEach(() => { cleanup(); push.mockReset(); });

  it("opens a project detail route from the full-width project list", () => {
    render(<ProjectsManager {...data} />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir projeto Projeto Natal 2026" }));
    expect(push).toHaveBeenCalledWith("/gestor/projetos/project-1");
  });

  it("shows published projects by default and supports archived and all filters", () => {
    const filteredData = {
      ...data,
      projects: [
        ...data.projects,
        { ...data.projects[0], id: "project-archived", name: "Projeto Arquivado", status: "ARCHIVED" as const },
      ],
    };
    render(<ProjectsManager {...filteredData} />);
    expect(screen.getByRole("button", { name: "Abrir projeto Projeto Natal 2026" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Abrir projeto Projeto Arquivado" })).not.toBeInTheDocument();
    const filter = screen.getByLabelText("Filtrar projetos");
    fireEvent.change(filter, { target: { value: "archived" } });
    expect(screen.getByRole("button", { name: "Abrir projeto Projeto Arquivado" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Abrir projeto Projeto Natal 2026" })).not.toBeInTheDocument();
    fireEvent.change(filter, { target: { value: "all" } });
    expect(screen.getByRole("button", { name: "Abrir projeto Projeto Natal 2026" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Abrir projeto Projeto Arquivado" })).toBeInTheDocument();
  });

  it("limits the projects summary cards to published projects", () => {
    const archivedProject = { ...data.projects[0], id: "project-archived", name: "Projeto Arquivado", status: "ARCHIVED" as const };
    const archivedEngagement = { ...contractData.engagements[0], id: "engagement-archived", project_id: archivedProject.id, contracted_cents: 33500 };
    const receivedInstallments = [
      { ...contractData.installments[0], settled_cents: 5000 },
      { ...contractData.installments[1], status: "OPEN" as const, settled_cents: 2500 },
      { ...contractData.installments[2], settled_cents: 0 },
      { ...contractData.installments[0], id: "archived-installment", engagement_id: archivedEngagement.id, amount_cents: 33500, settled_cents: 33500 },
    ];
    render(<ProjectsManager {...contractData} projects={[...data.projects, archivedProject]} engagements={[...contractData.engagements, archivedEngagement]} installments={receivedInstallments} />);

    const cards = screen.getByRole("region", { name: "Resumo de projetos" });
    const activeProjectsCard = within(cards).getByText("Projetos publicados").closest("article");
    const activeContractsCard = within(cards).getByText("Contratações ativas").closest("article");
    const contractedCard = within(cards).getByText("Valor contratado").closest("article");
    const receivedCard = within(cards).getByText("Total Recebido").closest("article");

    expect(activeProjectsCard).toHaveTextContent("1");
    expect(activeProjectsCard).toHaveTextContent("Somente projetos ativos");
    expect(activeContractsCard).toHaveTextContent("1");
    expect(activeContractsCard).toHaveTextContent("0 propostas aguardando aceite");
    expect(contractedCard).toHaveTextContent("R$ 150,00");
    expect(receivedCard).toHaveTextContent("R$ 75,00");
    expect(within(cards).queryByText("Resultado do módulo")).not.toBeInTheDocument();
  });

  it("shows zero contract metrics when every project is archived", () => {
    const archivedProjects = data.projects.map((project) => ({ ...project, status: "ARCHIVED" as const }));
    render(<ProjectsManager {...contractData} projects={archivedProjects} />);

    const cards = screen.getByRole("region", { name: "Resumo de projetos" });
    expect(within(cards).getByText("Projetos publicados").closest("article")).toHaveTextContent("0");
    expect(within(cards).getByText("Contratações ativas").closest("article")).toHaveTextContent("0");
    expect(within(cards).getByText("Valor contratado").closest("article")).toHaveTextContent("R$ 0,00");
    expect(within(cards).getByText("Total Recebido").closest("article")).toHaveTextContent("R$ 0,00");
  });

  it("opens the new-project modal prefilled for editing", () => {
    render(<ProjectsManager {...editableProjectData} />);
    fireEvent.click(screen.getByRole("button", { name: "Editar projeto Projeto Natal 2026" }));
    expect(screen.getByRole("dialog", { name: "Editar projeto" })).toBeInTheDocument();
    expect(screen.getByLabelText("Nome do projeto")).toHaveValue("Projeto Natal 2026");
    expect(screen.getByLabelText("Descrição")).toHaveValue("Jornada de fim de ano");
    expect(screen.getByLabelText("Pacote inicial")).toHaveValue("Experiência");
    expect(screen.getByRole("button", { name: "Salvar alterações" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Arquivar projeto" })).toBeInTheDocument();
  });

  it("opens a new project without initial package fields", () => {
    render(<ProjectsManager {...data} />);
    fireEvent.click(screen.getByRole("button", { name: "Novo projeto" }));
    expect(screen.getByRole("dialog", { name: "Novo projeto" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Pacote inicial")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Valor praticado")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Quantidade de sessões")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Criar e publicar" })).toBeInTheDocument();
  });

  it("offers publishing for an archived project", () => {
    const archivedData = {
      ...editableProjectData,
      projects: editableProjectData.projects.map((project) => ({ ...project, status: "ARCHIVED" as const })),
    };
    render(<ProjectsManager {...archivedData} />);
    fireEvent.change(screen.getByLabelText("Filtrar projetos"), { target: { value: "archived" } });
    fireEvent.click(screen.getByRole("button", { name: "Editar projeto Projeto Natal 2026" }));
    expect(screen.getByRole("button", { name: "Publicar projeto" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Arquivar projeto" })).not.toBeInTheDocument();
  });

  it("returns to the projects overview from the detail header", () => {
    render(<ProjectsManager {...data} projectId="project-1" />);
    expect(screen.getByRole("button", { name: "Novo contrato" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Voltar para Projetos" }));
    expect(push).toHaveBeenCalledWith("/gestor/projetos");
  });

  it("counts signed contracts as active even when their workflow status is stale", () => {
    const signedProposal = { ...contractData, engagements: contractData.engagements.map((item) => ({ ...item, status: "PROPOSAL" as const })) };
    render(<ProjectsManager {...signedProposal} projectId="project-1" />);
    expect(screen.getByText("Meta de contratos").closest("article")).toHaveTextContent("1 / 10");
  });

  it("shows the contract goal, revenue, received total and current net profit", () => {
    render(<ProjectsManager {...contractData} projectId="project-1" />);
    expect(screen.getByText("Meta de contratos").closest("article")).toHaveTextContent("1 / 10");
    const revenueCard = screen.getByText("Faturamento realizado").closest("article");
    expect(revenueCard).toHaveTextContent("R$ 150,00");
    expect(revenueCard).toHaveTextContent("Projetado: R$ 1.500,00");
    expect(revenueCard).toHaveTextContent("Total recebido: R$ 100,00");
    expect(screen.getByText("Lucro líquido atual").closest("article")).toHaveTextContent("R$ 100,00");
  });

  it("summarizes the project kanban as a funnel on the overview", () => {
    const { container } = render(<ProjectsManager {...data} projectId="project-1" />);
    expect(screen.getByRole("heading", { name: "Funil Kanban" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Etapas da jornada" })).not.toBeInTheDocument();
    expect(screen.getByText("4 quadros no projeto; acompanhe os eventos por etapa.")).toBeInTheDocument();
    expect(screen.getAllByText("0 eventos")).toHaveLength(4);
    expect([...container.querySelectorAll("span[style]")].every((bar) => (bar as HTMLElement).style.width === "0%")).toBe(true);
  });

  it("shows published packages with their client totals", () => {
    render(<ProjectsManager {...contractData} projectId="project-1" />);
    expect(screen.getByRole("heading", { name: "Clientes por pacote" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Pacote publicado" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Clientes" })).toBeInTheDocument();
    const row = within(screen.getByRole("table", { name: "Clientes por pacote" })).getByRole("row", { name: /Experiência/ });
    expect(row).toHaveTextContent("1 cliente");
  });

  it("shows the latest signed contracts with customer, package, entry, balance and signature date", () => {
    render(<ProjectsManager {...contractData} projectId="project-1" />);
    expect(screen.getByRole("columnheader", { name: "Nome do cliente" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Pacote contratado" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Valor da entrada" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Saldo do contrato" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Data da assinatura do contrato" })).toBeInTheDocument();
    const row = screen.getByRole("row", { name: /Cliente Teste/ });
    expect(row).toHaveTextContent("Experiência");
    expect(row).toHaveTextContent("R$ 50,00");
    expect(row).toHaveTextContent("R$ 100,00");
    expect(row).toHaveTextContent("15 de set. de 2026");
  });

  it("shows contract financial columns and opens Nova proposta in edit mode", () => {
    render(<ProjectsManager {...contractData} projectId="project-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Contratações/ }));
    expect(screen.getByRole("columnheader", { name: "Parcelas" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Valor" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Vencimento" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Entrada" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Saldo" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Assinatura" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Pacote" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Kanban" })).toBeInTheDocument();
    expect(screen.getByLabelText("Kanban atual da contratação de Cliente Teste")).toHaveTextContent("Em execução");
    expect(screen.queryByRole("combobox", { name: "Kanban atual da contratação de Cliente Teste" })).not.toBeInTheDocument();
    const contractRow = screen.getByRole("row", { name: /Cliente Teste/ });
    expect(contractRow).toHaveTextContent("1/2");
    expect(contractRow).toHaveTextContent("15/10/2026");
    fireEvent.click(screen.getByRole("button", { name: "Editar contratação de Cliente Teste" }));
    expect(screen.getByRole("dialog", { name: "Novo contrato" })).toBeInTheDocument();
    const customerInput = screen.getByLabelText("Cliente");
    expect(customerInput).toHaveValue("Cliente Teste");
    fireEvent.change(customerInput, { target: { value: "Cliente" } });
    expect(screen.getByRole("button", { name: "Selecionar Cliente Teste" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Selecionar Cliente Teste" }));
    expect(customerInput).toHaveValue("Cliente Teste");
    expect(screen.getByLabelText("Pacote")).toHaveValue("package-1");
    expect(screen.getByLabelText("Data da assinatura")).toHaveValue("2026-09-15");
    expect(screen.queryByLabelText("Status")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Vencimento da Entrada")).toHaveValue("2026-09-15");
    expect(screen.getByRole("button", { name: "Gerar Parcelas" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Valor"), { target: { value: "180,00" } });
    fireEvent.change(screen.getByLabelText("Total de parcelas"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Gerar Parcelas" }));
    expect(screen.getAllByText("R$ 40,00")).toHaveLength(2);
    expect(screen.getByText("15 de nov. de 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar alterações" })).toBeInTheDocument();
  });

  it("shows the latest project session status beside Kanban", () => {
    render(<ProjectsManager {...contractWithSessionsData} projectId="project-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Contratações/ }));
    expect(screen.getByRole("columnheader", { name: "Sessões" })).toBeInTheDocument();
    const contractRow = screen.getByRole("row", { name: /Cliente Teste/ });
    expect(contractRow).toHaveTextContent("1/5 Agendado");
  });

  it("marks a contract row red when the next installment is overdue", () => {
    const overdueData = { ...contractData, installments: contractData.installments.map((installment) => installment.installment_number === 0 ? { ...installment, due_on: "2020-01-01", status: "OPEN" as const } : installment) };
    render(<ProjectsManager {...overdueData} projectId="project-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Contratações/ }));
    expect(screen.getByRole("row", { name: /Cliente Teste/ }).className).toMatch(/engagementOverdue/);
  });

  it("opens the packages sub-screen and caps the editor at four packages", () => {
    render(<ProjectsManager {...data} projectId="project-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Pacotes/ }));
    fireEvent.click(screen.getByRole("button", { name: "Adicionar Contrato" }));
    expect(screen.getByRole("status")).toHaveTextContent("Função em desenvolvimento");
    const addButton = screen.getByRole("button", { name: /Adicionar pacote \(0\/4\)/ });
    fireEvent.click(addButton);
    fireEvent.click(addButton);
    fireEvent.click(addButton);
    fireEvent.click(addButton);
    expect(screen.getByRole("button", { name: /Adicionar pacote \(4\/4\)/ })).toBeDisabled();
    expect(screen.getAllByText("Precificação Sugerida")).toHaveLength(4);
    expect(screen.queryByLabelText("Descrição")).not.toBeInTheDocument();
    const title = screen.getByLabelText("Título do pacote 1");
    fireEvent.change(title, { target: { value: "Experiência" } });
    expect(title).toHaveValue("Experiência");
  });

  it("uses project allocation as fixed cost and adds services with project commissions", () => {
    const packageData = {
      ...data,
      costItems: [{ id: "cost-1", organization_id: "org-1", project_id: "project-1", kind: "INVESTMENT" as const, name: "Cenário", description: null, amount_cents: 2000, active: true, sort_order: 1, created_at: "2026-09-15T00:00:00.000Z" }],
      services: [
        { id: "service-1", name: "Corte", price_cents: 3500, active: true, availability: "CLIENT" as const },
        { id: "service-2", name: "Consultoria interna", price_cents: 2000, active: true, availability: "HIDDEN" as const },
        { id: "service-3", name: "Treinamento técnico", price_cents: 1500, active: true, availability: "INTERNAL" as const },
      ],
      barberServices: [
        { service_id: "service-1", barber_id: "barber-1" },
        { service_id: "service-2", barber_id: "barber-1" },
        { service_id: "service-3", barber_id: "barber-1" },
      ],
    };
    render(<ProjectsManager {...packageData} projectId="project-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Pacotes/ }));
    fireEvent.click(screen.getByRole("button", { name: /Adicionar pacote/ }));
    fireEvent.change(screen.getByLabelText("Total de sessões"), { target: { value: "3" } });
    expect(screen.getByLabelText("Custo Fixo")).toHaveValue("6,00");
    expect(screen.getByLabelText("Custo Fixo")).toHaveAttribute("readonly");
    expect(screen.getByText("Custo fixo").parentElement).toHaveTextContent("R$ 6,00");
    expect(screen.getByText("Preço de Venda")).toBeInTheDocument();
    expect(screen.getByLabelText("Precificação Sugerida")).toHaveValue("R$\u00a012,00");
    fireEvent.click(screen.getByRole("button", { name: "Adicionar serviço" }));
    const serviceSelect = screen.getByLabelText("Serviço do pacote 1");
    expect(within(serviceSelect).getByRole("option", { name: "Corte" })).toBeInTheDocument();
    expect(within(serviceSelect).getByRole("option", { name: "Consultoria interna" })).toBeInTheDocument();
    expect(within(serviceSelect).getByRole("option", { name: "Treinamento técnico" })).toBeInTheDocument();
    fireEvent.change(serviceSelect, { target: { value: "service-1" } });
    fireEvent.change(screen.getByLabelText("Profissional do serviço 1"), { target: { value: "barber-1" } });
    fireEvent.change(screen.getByLabelText("Comissão do serviço 1"), { target: { value: "15,00" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar serviço" }));
    expect(screen.getByText("Corte")).toBeInTheDocument();
    expect(screen.getByText("Custos com comissão").parentElement).toHaveTextContent("R$ 15,00");
    expect(screen.getByLabelText("Precificação Sugerida")).toHaveValue("R$\u00a042,00");
  });

  it("opens the investments sub-screen with fixed costs and investments", () => {
    render(<ProjectsManager {...data} projectId="project-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Investimentos/ }));
    expect(screen.getAllByRole("heading", { name: "Investimentos" })).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Custos Fixos" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Custos Variáveis" })).not.toBeInTheDocument();
    const category = screen.getByLabelText("Categoria");
    expect(within(category).queryByRole("option", { name: "Custos Variáveis" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adicionar" })).toBeDisabled();
  });

  it("asks for a destination before removing a board that has cards", () => {
    render(<ProjectsManager {...kanbanData} projectId="project-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Kanban/ }));
    fireEvent.click(screen.getByRole("button", { name: "Editar Quadro" }));
    fireEvent.click(screen.getByRole("button", { name: "Remover quadro Aguardando aceite" }));
    expect(screen.getByRole("dialog", { name: "Remover quadro" })).toBeInTheDocument();
    expect(screen.getByLabelText("Quadro destino")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Em execução" })).toBeInTheDocument();
  });

  it("shows a required responsible selector on every board", () => {
    render(<ProjectsManager {...data} projectId="project-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Kanban/ }));
    expect(screen.getAllByLabelText(/Responsável do quadro/)).toHaveLength(4);
    expect(screen.getAllByLabelText(/Responsável do quadro/)[0]).toHaveValue("barber-1");
  });
});
