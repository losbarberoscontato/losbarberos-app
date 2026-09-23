import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { kanbanDeadlineTone, ProjectsManager } from "@/components/connected-manager/projects-manager";
import styles from "@/components/connected-manager/connected-manager.module.css";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), refresh: vi.fn(), push: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock("@/components/connected-manager/mutation-utils", () => ({
  connectedClient: () => ({ rpc: mocks.rpc, from: mocks.from }),
  assertResult: async (result: { error: unknown }) => { if (result.error) throw new Error(String(result.error)); },
  runMutation: async (_setMessage: unknown, mutation: () => Promise<void>) => { await mutation(); return true; },
}));

const board = (id: string, name: string, systemKey: "PROPOSAL" | "ACTIVE" | "COMPLETED" | "CANCELED", position: number) => ({ id, organization_id: "org-1", project_id: "project-1", name, system_key: systemKey, position, responsible_barber_id: "barber-1", active: true, created_at: "2026-09-15T00:00:00.000Z" });
const data = {
  organizationId: "org-1", enabled: true, retentionStatus: "NONE" as const,
  projects: [{ id: "project-1", organization_id: "org-1", name: "Projeto", description: null, status: "PUBLISHED" as const, starts_on: null, sales_close_on: null, ends_on: null, goal_contracts: 10, created_at: "2026-09-15T00:00:00.000Z" }],
  packages: [], steps: [], engagements: [{ id: "engagement-1", organization_id: "org-1", project_id: "project-1", customer_id: "customer-1", package_id: "package-1", kanban_board_id: "board-1", status: "PROPOSAL" as const, contracted_cents: 15000, proposal_sent_at: null, accepted_at: null, created_at: "2026-09-15T00:00:00.000Z" }],
  installments: [], customers: [{ id: "customer-1", full_name: "Cliente", phone_e164: null, email: null }], services: [], barbers: [{ id: "barber-1", display_name: "Alef Gonçalves" }], packageBarbers: [], costItems: [],
  kanbanBoards: [board("board-1", "Aguardando aceite", "PROPOSAL", 1), board("board-2", "Em execução", "ACTIVE", 2), board("board-3", "Concluídas", "COMPLETED", 3), board("board-4", "Canceladas", "CANCELED", 4)],
};

const generalData = {
  ...data,
  engagements: [{ ...data.engagements[0], event_description: "Preparar briefing", event_due_on: "2026-09-30", kanban_received_at: "2026-09-18T14:30:00.000Z", kanban_received_by_name: "Julio Heiden" }],
  engagementLastComments: { "engagement-1": { engagement_id: "engagement-1", body: "Cliente confirmou o briefing.", author_name: "Julio Heiden", created_at: "2026-09-18T15:00:00.000Z" } },
  kanbanSectors: [{ id: "sector-1", organization_id: "org-1", name: "Comercial", position: 1, responsible_barber_id: "barber-1", active: true, created_at: "2026-09-15T00:00:00.000Z" }],
  kanbanBoards: data.kanbanBoards.map((item) => ({ ...item, sector_id: "sector-1" })),
};

const sessionData = {
  ...data,
  customers: [{ id: "customer-1", full_name: "Cliente", phone_e164: null, email: null }],
  packages: [{ id: "package-1", organization_id: "org-1", project_id: "project-1", name: "Experiência", description: null, price_cents: 15000, sessions_count: 1, duration_minutes: 60, fixed_cost_per_hour_cents: 0, extra_costs_cents: 0, extra_costs_description: null, tax_rate_bps: 0, card_rate_bps: 0, profit_margin_bps: 5000, deposit_cents: 0, suggested_price_cents: 15000, sort_order: 1, active: true }],
  services: [{ id: "service-1", name: "Datas Comemorativas", price_cents: 5000, active: true }],
  engagements: [{ ...data.engagements[0], package_id: "package-1", status: "ACTIVE" as const }],
  packageServiceAssignments: [{ id: "assignment-1", project_package_id: "package-1", service_id: "service-1", barber_id: "barber-1", commission_cents: 1000 }],
  projectSessions: [{ id: "project-session-1", organization_id: "org-1", engagement_id: "engagement-1", session_number: 1, status: "OPEN" as const, appointment_id: null, service_id: null, barber_id: null, appointment: null }],
  environments: [{ id: "environment-1", organization_id: "org-1", location_id: "location-1", name: "Sala/Cadeira 1", sort_order: 1, active: true }],
};

const internalServiceData = {
  ...generalData,
  packages: sessionData.packages,
  services: [...sessionData.services, { id: "service-2", name: "Organização de arquivos", price_cents: 0, active: true, availability: "INTERNAL" as const }],
  packageServiceAssignments: sessionData.packageServiceAssignments,
  internalServices: [],
};

describe("kanban board editing", () => {
  afterEach(() => { cleanup(); mocks.rpc.mockReset(); mocks.from.mockReset(); mocks.refresh.mockReset(); mocks.push.mockReset(); vi.useRealTimers(); });

  it("classifica as cores do prazo por dias corridos", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-18T12:00:00-03:00"));
    expect(kanbanDeadlineTone("2026-09-17")).toBe("overdue");
    expect(kanbanDeadlineTone("2026-09-18")).toBe("");
    expect(kanbanDeadlineTone("2026-09-19")).toBe("orange");
    expect(kanbanDeadlineTone("2026-09-21")).toBe("yellow");
    expect(kanbanDeadlineTone("2026-09-25")).toBe("green");
  });

  it("persists a renamed board", async () => {
    mocks.rpc.mockResolvedValue({ data: {}, error: null });
    render(<ProjectsManager {...data} projectId="project-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Kanban/ }));
    fireEvent.click(screen.getByRole("button", { name: "Editar Quadro" }));
    const title = screen.getByLabelText("Título do quadro Aguardando aceite");
    fireEvent.change(title, { target: { value: "Qualificação" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar título Qualificação" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("upsert_project_kanban_board", expect.objectContaining({ p_id: "board-1", p_name: "Qualificação", p_responsible_barber_id: "barber-1" })));
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("shows a warning for boards without a sector", () => {
    const unassignedBoards = data.kanbanBoards.map((item, index) => index === 0 ? { ...item, sector_id: null } : { ...item, sector_id: "sector-1" });
    render(<ProjectsManager {...data} projectId="project-1" kanbanSectors={generalData.kanbanSectors} kanbanBoards={unassignedBoards} />);
    fireEvent.click(screen.getByRole("button", { name: /Kanban/ }));
    expect(screen.getByLabelText("Setor do quadro Aguardando aceite")).toHaveValue("");
    expect(screen.getByText("Quadros sem setor definido não aparecem no kanban geral")).toBeInTheDocument();
  });

  it("moves cards to the selected destination when deleting a board", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    render(<ProjectsManager {...data} projectId="project-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Kanban/ }));
    fireEvent.click(screen.getByRole("button", { name: "Editar Quadro" }));
    fireEvent.click(screen.getByRole("button", { name: "Remover quadro Aguardando aceite" }));
    fireEvent.change(screen.getByLabelText("Quadro destino"), { target: { value: "board-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Remover quadro" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("delete_project_kanban_board", { p_organization_id: "org-1", p_project_id: "project-1", p_id: "board-1", p_destination_id: "board-2" }));
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("creates a new board in edit mode", async () => {
    mocks.rpc.mockResolvedValue({ data: board("board-5", "Em revisão", "PROPOSAL", 5), error: null });
    render(<ProjectsManager {...data} projectId="project-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Kanban/ }));
    fireEvent.click(screen.getByRole("button", { name: "Editar Quadro" }));
    fireEvent.click(screen.getByRole("button", { name: "Adicionar quadro" }));
    fireEvent.change(screen.getByLabelText("Título do quadro"), { target: { value: "Em revisão" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("upsert_project_kanban_board", expect.objectContaining({ p_id: null, p_name: "Em revisão", p_position: 5, p_responsible_barber_id: "barber-1" })));
  });

  it("moves a card to another board by drag and drop", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    render(<ProjectsManager {...data} projectId="project-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Kanban/ }));
    const card = screen.getByText("Cliente").closest("article");
    const destination = screen.getByText("Em execução").closest("section");
    expect(card).not.toBeNull();
    expect(destination).not.toBeNull();
    fireEvent.dragStart(card as HTMLElement, { dataTransfer: { effectAllowed: "", setData: vi.fn() } });
    fireEvent.drop(destination as HTMLElement, { dataTransfer: { getData: () => "engagement-1" } });
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("move_project_engagement_to_kanban_board", { p_organization_id: "org-1", p_project_id: "project-1", p_engagement_id: "engagement-1", p_destination_board_id: "board-2" }));
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("saves the deadline from the event editor after moving the card", async () => {
    mocks.rpc.mockResolvedValue({ data: {}, error: null });
    render(<ProjectsManager {...data} projectId="project-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Kanban/ }));
    const card = screen.getByText("Cliente").closest("article");
    const destination = screen.getByText("Em execução").closest("section");
    expect(card).not.toBeNull();
    expect(destination).not.toBeNull();
    fireEvent.dragStart(card as HTMLElement, { dataTransfer: { effectAllowed: "", setData: vi.fn() } });
    fireEvent.drop(destination as HTMLElement, { dataTransfer: { getData: () => "engagement-1" } });
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("move_project_engagement_to_kanban_board", expect.objectContaining({ p_engagement_id: "engagement-1", p_destination_board_id: "board-2" })));

    fireEvent.doubleClick(screen.getByText("Cliente").closest("article") as HTMLElement);
    const dialog = screen.getByRole("dialog", { name: "Em execução" });
    fireEvent.change(within(dialog).getByLabelText("Data prazo"), { target: { value: "2026-09-30" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar evento" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("save_project_engagement_event", expect.objectContaining({ p_engagement_id: "engagement-1", p_due_on: "2026-09-30" })));
    expect(screen.getByLabelText("Data prazo de Cliente")).toHaveValue("2026-09-30");
  });

  it("creates a standalone card in the first board without associating a customer", async () => {
    const createdCard = { id: "internal-card-1", organization_id: "org-1", project_id: "project-1", kanban_board_id: "board-1", title: "Card avulso", created_at: "2026-09-22T12:00:00.000Z" };
    mocks.rpc.mockResolvedValue({ data: createdCard, error: null });
    render(<ProjectsManager {...internalServiceData} projectId="project-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Kanban/ }));
    fireEvent.click(screen.getByRole("button", { name: "Criar Card" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("create_project_kanban_internal_card", {
      p_organization_id: "org-1", p_project_id: "project-1",
    }));
    expect(screen.getByText("Card avulso")).toBeInTheDocument();
    const card = screen.getByText("Card avulso").closest("article");
    expect(card).not.toHaveTextContent("Cliente");
    fireEvent.doubleClick(card as HTMLElement);
    expect(screen.getByRole("dialog", { name: "Card avulso · Serviço Interno" })).toBeInTheDocument();
  });

  it("saves an internal service on a standalone card using the selected package commission", async () => {
    const standaloneCard = { id: "internal-card-1", organization_id: "org-1", project_id: "project-1", kanban_board_id: "board-1", title: "Card avulso", created_at: "2026-09-22T12:00:00.000Z" };
    mocks.rpc.mockImplementation(async (name: string) => name === "create_project_kanban_internal_card"
      ? { data: standaloneCard, error: null }
      : { data: { id: "internal-service-1", organization_id: "org-1", project_id: "project-1", engagement_id: null, internal_card_id: standaloneCard.id, kanban_board_id: "board-1", package_assignment_id: "assignment-1", service_id: "service-1", service_name: "Datas Comemorativas", barber_id: "barber-1", commission_cents: 1000, delivery_on: "2026-09-22", status: "OPEN" }, error: null });
    render(<ProjectsManager {...internalServiceData} projectId="project-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Kanban/ }));
    fireEvent.click(screen.getByRole("button", { name: "Criar Card" }));
    await waitFor(() => expect(screen.getByText("Card avulso")).toBeInTheDocument());
    fireEvent.doubleClick(screen.getByText("Card avulso").closest("article") as HTMLElement);
    const dialog = screen.getByRole("dialog", { name: "Card avulso · Serviço Interno" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Adicionar Serviço Interno" }));
    const serviceDialog = screen.getByRole("dialog", { name: "Adicionar Serviço Interno" });
    expect(within(serviceDialog).getByRole("option", { name: /Experiência · Datas Comemorativas/ })).toBeInTheDocument();
    fireEvent.change(within(serviceDialog).getByLabelText("Serviço interno"), { target: { value: "assignment-1" } });
    fireEvent.click(within(serviceDialog).getByRole("button", { name: "Adicionar serviço" }));
    fireEvent.change(within(dialog).getByLabelText("Entrega do serviço interno"), { target: { value: "2026-09-22" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar serviço interno" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("upsert_project_kanban_internal_card_service", expect.objectContaining({
      p_organization_id: "org-1", p_project_id: "project-1", p_internal_card_id: standaloneCard.id,
      p_board_id: "board-1", p_service_assignment_id: "assignment-1", p_commission_cents: 1000,
      p_delivery_on: "2026-09-22",
    })));
  });

  it("loads only environments available for the selected project professional", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ id: "environment-1", name: "Sala/Cadeira 1", sort_order: 1 }], error: null });
    render(<ProjectsManager {...sessionData} projectId="project-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Contratações/ }));
    fireEvent.click(screen.getByRole("button", { name: "Editar contratação de Cliente" }));
    const contractDialog = screen.getByRole("dialog", { name: "Novo contrato" });
    fireEvent.click(within(contractDialog).getByRole("button", { name: /Agendar/ }));

    const bookingDialog = await screen.findByRole("dialog", { name: "Reserve um horário" });
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("get_project_session_environments", expect.objectContaining({
      p_session_id: "project-session-1",
      p_barber_id: "barber-1",
      p_service_id: "service-1",
    })));
    expect(within(bookingDialog).getByRole("option", { name: /Sala\/Cadeira 1/ })).toBeInTheDocument();
  });

  it("opens the event editor on double click and saves event details separately from comments", async () => {
    mocks.rpc.mockResolvedValue({ data: {}, error: null });
    render(<ProjectsManager {...data} projectId="project-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Kanban/ }));
    const card = screen.getByText("Cliente").closest("article");
    expect(card).not.toBeNull();
    fireEvent.doubleClick(card as HTMLElement);

    const dialog = screen.getByRole("dialog", { name: "Aguardando aceite" });
    expect(within(dialog).getByDisplayValue("Cliente")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Descrição do evento"), { target: { value: "Preparar briefing" } });
    fireEvent.change(within(dialog).getByLabelText("Link 1 - URL"), { target: { value: "https://example.com/briefing" } });
    fireEvent.change(within(dialog).getByLabelText("Data prazo"), { target: { value: "2026-09-30" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar evento" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("save_project_engagement_event", expect.objectContaining({
      p_engagement_id: "engagement-1",
      p_description: "Preparar briefing",
      p_link_1: "https://example.com/briefing",
      p_due_on: "2026-09-30",
    })));

    fireEvent.doubleClick(card as HTMLElement);
    const reopened = screen.getByRole("dialog", { name: "Aguardando aceite" });
    fireEvent.change(within(reopened).getByLabelText("Adicionar comentário"), { target: { value: "Cliente confirmou o briefing." } });
    fireEvent.click(within(reopened).getByRole("button", { name: "Adicionar comentário" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("save_project_engagement_comment", expect.objectContaining({
      p_engagement_id: "engagement-1",
      p_comment_id: null,
      p_body: "Cliente confirmou o briefing.",
    })));
  });

  it("shows the general kanban with project and responsible filters", async () => {
    mocks.rpc.mockResolvedValue({ data: {}, error: null });
    render(<ProjectsManager {...generalData} />);
    expect(screen.getByRole("heading", { name: "Kanban Geral" })).toBeInTheDocument();
    const projectFilter = screen.getByLabelText("Filtrar Kanban Geral por projeto");
    fireEvent.change(projectFilter, { target: { value: "project-1" } });
    expect(screen.getByText("Cliente")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filtrar Kanban Geral por responsável"), { target: { value: "barber-1" } });
    expect(screen.getByText("Cliente")).toBeInTheDocument();
    expect(screen.getByText("Recebido")).toBeInTheDocument();
    expect(screen.getByText("Julio Heiden")).toBeInTheDocument();
    expect(screen.getByText("Preparar briefing")).toBeInTheDocument();
    expect(screen.getByText("Cliente confirmou o briefing.")).toBeInTheDocument();
    expect(screen.getByLabelText("Data prazo de Cliente")).toHaveValue("2026-09-30");
    fireEvent.change(screen.getByLabelText("Data prazo de Cliente"), { target: { value: "2026-10-01" } });
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("save_project_engagement_event", expect.objectContaining({
      p_engagement_id: "engagement-1",
      p_due_on: "2026-10-01",
    })));
    expect(screen.getByLabelText("Data prazo de Cliente")).toHaveValue("2026-10-01");
    const card = screen.getByText("Cliente").closest("article");
    expect(card).not.toBeNull();
    fireEvent.doubleClick(card as HTMLElement);
    expect(screen.getByRole("dialog", { name: "Aguardando aceite" })).toBeInTheDocument();
  });

  it("adds a service commission to package pricing and saves assignments atomically", async () => {
    mocks.rpc.mockResolvedValue({ data: { id: "package-1" }, error: null });
    const packageData = {
      ...data,
      projects: data.projects.map((project) => ({ ...project, goal_contracts: 1 })),
      costItems: [{ id: "cost-1", organization_id: "org-1", project_id: "project-1", kind: "FIXED" as const, name: "Custo fixo", description: null, amount_cents: 10420, active: true, sort_order: 0, created_at: "2026-09-15T00:00:00.000Z" }],
      services: [{ id: "service-1", name: "Corte", price_cents: 7000, active: true, availability: "CLIENT" as const }],
      barbers: [...data.barbers, { id: "barber-2", display_name: "Alice Gonçalves" }],
      barberServices: [{ barber_id: "barber-1", service_id: "service-1" }],
    };
    render(<ProjectsManager {...packageData} projectId="project-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Pacotes/ }));
    fireEvent.click(screen.getByRole("button", { name: /Adicionar pacote/ }));

    fireEvent.change(screen.getByLabelText("Título do pacote 1"), { target: { value: "Pacote teste" } });
    expect(screen.getByText("Custo fixo").parentElement).toHaveTextContent("R$ 104,20 (—)");
    fireEvent.change(screen.getByLabelText(/Preço praticado/), { target: { value: "390,10" } });
    fireEvent.change(screen.getByLabelText("Sinal/entrada (R$)"), { target: { value: "50,00" } });
    fireEvent.change(screen.getByLabelText("Custos Extras (R$)"), { target: { value: "60,00" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar serviço" }));
    expect(screen.getByRole("button", { name: "Salvar serviço" })).toHaveClass(styles.button, styles.buttonSoft, styles.iconButton);
    expect(screen.getByRole("button", { name: "Cancelar serviço" })).toHaveClass(styles.button, styles.buttonSoft, styles.iconButton);
    const serviceSelect = screen.getByLabelText("Serviço do pacote 1");
    const barberSelect = screen.getByLabelText("Profissional do serviço 1");
    expect(barberSelect).toBeDisabled();
    expect(screen.getByText("Escolha um serviço para listar os profissionais habilitados.")).toBeInTheDocument();
    fireEvent.change(serviceSelect, { target: { value: "service-1" } });
    expect(barberSelect).toBeEnabled();
    fireEvent.change(barberSelect, { target: { value: "barber-1" } });
    expect(screen.getByRole("option", { name: "Alef Gonçalves" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Alice Gonçalves" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Comissão do serviço 1"), { target: { value: "60,00" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar serviço" }));

    expect(screen.getByRole("button", { name: "Remover Corte - Alef Gonçalves" })).toHaveClass(styles.button, styles.buttonSoft, styles.iconButton);
    expect(screen.getByText("Custo fixo").parentElement).toHaveTextContent("R$ 104,20 (26,71%)");
    expect(screen.getByText("Custos extras").parentElement).toHaveTextContent("R$ 60,00 (15,38%)");
    expect(screen.getByText("Custos com comissão").parentElement).toHaveTextContent("R$ 60,00 (15,38%)");
    expect(screen.getByText("Custo total da entrega").parentElement).toHaveTextContent("R$ 224,20 (57,47%)");
    expect(screen.getByText("Custo total da entrega").parentElement).toHaveClass(styles.packageCostTotal);
    expect(screen.getByText("Impostos estimados").parentElement).toHaveTextContent("R$ 0,00 (0,00%)");
    expect(screen.getByText("Taxa cartão estimada").parentElement).toHaveTextContent("R$ 0,00 (0,00%)");
    expect(screen.getByText("Lucro estimado").parentElement).toHaveTextContent("R$ 165,90 (42,53%)");
    expect(screen.getByText("Sinal de reserva").parentElement).toHaveTextContent("R$ 50,00 (12,82%)");
    expect(screen.getByText("Saldo após o sinal").parentElement).toHaveTextContent("R$ 340,10 (87,18%)");
    expect(screen.getByText("Precificação Sugerida").parentElement?.querySelector("input")).toHaveValue("R$\u00a0448,40");
    fireEvent.click(screen.getByRole("button", { name: "Salvar pacote" }));

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("upsert_project_package", expect.objectContaining({
      p_service_assignments: [{ service_id: "service-1", barber_id: "barber-1", commission_cents: 6000 }],
    })));
  });

  it("rehydrates and preserves saved tax and card rates", async () => {
    const savedPackage = {
      id: "package-1", organization_id: "org-1", project_id: "project-1", name: "Pacote salvo", description: null,
      price_cents: 39000, sessions_count: 1, duration_minutes: 60, fixed_cost_per_hour_cents: 10420,
      extra_costs_cents: 4000, extra_costs_description: null, tax_rate_bps: 750, card_rate_bps: 199,
      profit_margin_bps: 3800, deposit_cents: 5000, suggested_price_cents: 0, sort_order: 1, active: true,
    };
    mocks.rpc.mockResolvedValue({ data: savedPackage, error: null });
    render(<ProjectsManager {...data} packages={[savedPackage]} projectId="project-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Pacotes/ }));

    expect(screen.getByLabelText("Impostos (%)")).toHaveValue(7.5);
    expect(screen.getByLabelText("Taxas banco/cartão (%)")).toHaveValue(1.99);
    fireEvent.click(screen.getByRole("button", { name: "Salvar pacote" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("upsert_project_package", expect.objectContaining({
      p_tax_rate_bps: 750,
      p_card_rate_bps: 199,
      p_profit_margin_bps: 3800,
    })));
  });

  it("collapses only the selected package price breakdown", () => {
    render(<ProjectsManager {...data} projectId="project-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Pacotes/ }));
    fireEvent.click(screen.getByRole("button", { name: /Adicionar pacote/ }));
    fireEvent.click(screen.getByRole("button", { name: /Adicionar pacote/ }));

    const toggles = screen.getAllByRole("button", { name: "Recolher decomposição do preço" });
    const firstPanel = document.getElementById(toggles[0].getAttribute("aria-controls") ?? "");
    const secondPanel = document.getElementById(toggles[1].getAttribute("aria-controls") ?? "");
    expect(firstPanel).toBeInTheDocument();
    expect(secondPanel).toBeInTheDocument();
    expect(toggles[0]).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(toggles[0]);
    expect(toggles[0]).toHaveAttribute("aria-expanded", "false");
    expect(firstPanel).not.toBeVisible();
    expect(secondPanel).toBeVisible();

    fireEvent.click(toggles[0]);
    expect(toggles[0]).toHaveAttribute("aria-expanded", "true");
    expect(firstPanel).toBeVisible();
  });

  it("asks for the destination project board when moving an event between general sectors", async () => {
    mocks.rpc.mockResolvedValue({ data: {}, error: null });
    const moveData = {
      ...generalData,
      kanbanSectors: [
        { ...generalData.kanbanSectors[0], name: "Origem" },
        { ...generalData.kanbanSectors[0], id: "sector-2", name: "Destino", position: 2 },
      ],
      kanbanBoards: generalData.kanbanBoards.map((item, index) => ({ ...item, sector_id: index === 0 ? "sector-1" : index < 3 ? "sector-2" : "sector-1" })),
    };
    render(<ProjectsManager {...moveData} />);
    const card = screen.getByText("Cliente").closest("article");
    const destination = screen.getByText("Destino").closest("section");
    expect(card).not.toBeNull();
    expect(destination).not.toBeNull();
    fireEvent.dragStart(card as HTMLElement, { dataTransfer: { effectAllowed: "", setData: vi.fn() } });
    fireEvent.drop(destination as HTMLElement, { dataTransfer: { getData: () => "engagement-1" } });

    const dialog = screen.getByRole("dialog", { name: "Selecionar quadro destino" });
    expect(within(dialog).getByRole("option", { name: "Em execução" })).toBeInTheDocument();
    expect(within(dialog).getByRole("option", { name: "Concluídas" })).toBeInTheDocument();
    expect(mocks.rpc).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText("Quadro destino do evento"), { target: { value: "board-3" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Mover evento" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("move_project_engagement_to_kanban_board", {
      p_organization_id: "org-1",
      p_project_id: "project-1",
      p_engagement_id: "engagement-1",
      p_destination_board_id: "board-3",
    }));
  });

  it("hides unassigned boards and inactive projects from the general kanban", () => {
    const inactiveProject = { ...data.projects[0], id: "project-archived", name: "Projeto arquivado", status: "ARCHIVED" as const };
    const inactiveBoard = { ...board("board-archived", "Arquivado", "PROPOSAL", 5), project_id: "project-archived", sector_id: null };
    const inactiveEngagement = { ...data.engagements[0], id: "engagement-archived", project_id: "project-archived", kanban_board_id: "board-archived", customer_id: "customer-archived" };
    render(<ProjectsManager {...generalData} projects={[...generalData.projects, inactiveProject]} kanbanBoards={[...generalData.kanbanBoards, inactiveBoard]} engagements={[...generalData.engagements, inactiveEngagement]} customers={[...generalData.customers, { id: "customer-archived", full_name: "Cliente arquivado", phone_e164: null, email: null }]} />);
    expect(screen.queryByText("Cliente arquivado")).not.toBeInTheDocument();
    expect(screen.queryByText("Projeto arquivado")).not.toBeInTheDocument();
  });

  it("persists the contract signature date entered in the edit form", async () => {
    mocks.rpc.mockResolvedValue({ data: {}, error: null });
    render(<ProjectsManager {...data} projectId="project-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Contratações/ }));
    fireEvent.click(screen.getByRole("button", { name: "Editar contratação de Cliente" }));
    const dialog = screen.getByRole("dialog", { name: "Novo contrato" });
    expect(within(dialog).queryByRole("button", { name: "Assinar Contrato" })).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Data da assinatura"), { target: { value: "2026-09-20" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("save_project_contract", expect.objectContaining({
      p_engagement_id: "engagement-1",
      p_project_id: "project-1",
      p_status: "PROPOSAL",
    })));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("set_project_engagement_status", {
      p_organization_id: "org-1",
      p_project_id: "project-1",
      p_engagement_id: "engagement-1",
      p_status: "ACTIVE",
      p_accepted_on: "2026-09-20",
      p_kanban_board_id: "board-2",
    }));
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("updates an existing signature date and closes the edit modal", async () => {
    mocks.rpc.mockResolvedValue({ data: {}, error: null });
    const signedData = {
      ...data,
      engagements: [{ ...data.engagements[0], status: "ACTIVE" as const, kanban_board_id: "board-2", accepted_at: "2026-09-15T12:00:00.000Z" }],
    };
    render(<ProjectsManager {...signedData} projectId="project-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Contratações/ }));
    fireEvent.click(screen.getByRole("button", { name: "Editar contratação de Cliente" }));
    const dialog = screen.getByRole("dialog", { name: "Novo contrato" });
    fireEvent.change(within(dialog).getByLabelText("Data da assinatura"), { target: { value: "2026-09-22" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("set_project_engagement_status", expect.objectContaining({
      p_engagement_id: "engagement-1",
      p_status: "ACTIVE",
      p_accepted_on: "2026-09-22",
      p_kanban_board_id: "board-2",
    })));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Novo contrato" })).not.toBeInTheDocument());
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("creates a missing customer from the new-contract modal and selects them", async () => {
    const createdCustomer = { id: "customer-new", full_name: "Cliente manual", phone_e164: "+5511999999999", email: "cliente@example.com" };
    const single = vi.fn().mockResolvedValue({ data: createdCustomer, error: null });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    mocks.from.mockReturnValue({ insert });
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const packageRecord = {
      id: "package-1", organization_id: "org-1", project_id: "project-1", name: "Pacote", description: null,
      price_cents: 39000, sessions_count: 1, duration_minutes: 60, fixed_cost_per_hour_cents: 0,
      extra_costs_cents: 0, extra_costs_description: null, tax_rate_bps: 0, card_rate_bps: 0,
      profit_margin_bps: 5000, deposit_cents: 5000, suggested_price_cents: 39000, sort_order: 1, active: true,
    };
    render(<ProjectsManager {...data} customers={[]} packages={[packageRecord]} projectId="project-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Contratações/ }));
    fireEvent.click(screen.getByRole("button", { name: "Novo contrato" }));
    const contractDialog = screen.getByRole("dialog", { name: "Novo contrato" });
    fireEvent.change(within(contractDialog).getByLabelText("Cliente"), { target: { value: "Cliente manual" } });
    fireEvent.click(within(contractDialog).getByRole("button", { name: "Cadastrar novo cliente" }));

    const customerDialog = screen.getByRole("dialog", { name: "Novo cliente" });
    expect(within(customerDialog).getByLabelText("Nome completo")).toHaveValue("Cliente manual");
    fireEvent.change(within(customerDialog).getByLabelText("Telefone"), { target: { value: "11999999999" } });
    fireEvent.change(within(customerDialog).getByLabelText("E-mail"), { target: { value: "cliente@example.com" } });
    fireEvent.click(within(customerDialog).getByRole("button", { name: "Cadastrar" }));

    await waitFor(() => expect(mocks.from).toHaveBeenCalledWith("customers"));
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      organization_id: "org-1",
      full_name: "Cliente manual",
      phone_e164: "+5511999999999",
      email: "cliente@example.com",
      active: true,
    }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Novo cliente" })).not.toBeInTheDocument());
    expect(screen.getByRole("dialog", { name: "Novo contrato" })).toBeInTheDocument();
    expect(within(contractDialog).getByText("Cliente manual selecionado")).toBeInTheDocument();
    expect(within(contractDialog).getByLabelText("Cliente")).toHaveValue("Cliente manual");
    fireEvent.click(within(contractDialog).getByRole("button", { name: "Criar contrato" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("save_project_contract", expect.objectContaining({
      p_customer_id: "customer-new",
      p_project_id: "project-1",
    })));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Novo contrato" })).not.toBeInTheDocument());
  });

  it("sends the explicit receipt date when settling a project installment", async () => {
    mocks.rpc.mockResolvedValue({ data: "settlement-1", error: null });
    const installment = {
      id: "installment-1", organization_id: "org-1", engagement_id: "engagement-1", installment_number: 0,
      due_on: "2026-09-21", amount_cents: 5000, status: "OPEN" as const, paid_at: null,
      financial_entry_id: "entry-1", settled_cents: 0, remaining_cents: 5000, last_paid_at: null,
      payment_method: null, financial_account_id: null, financial_account_name: null, received_by: null, received_by_name: null,
    };
    render(<ProjectsManager {...data} projectId="project-1" installments={[installment]} chartAccounts={[{
      id: "chart-1", organization_id: "org-1", parent_id: null, code: null, name: "Receita de contratos", kind: "REVENUE", active: true,
    }]} financialAccounts={[{
      id: "account-1", organization_id: "org-1", kind: "CASH", name: "Caixa físico", bank_code: null, branch: null,
      account_number: null, description: null, opening_balance_cents: 0, active: true,
    }]} />);

    fireEvent.click(screen.getByRole("button", { name: /Contratações/ }));
    fireEvent.click(screen.getByRole("button", { name: "Editar contratação de Cliente" }));
    const contractDialog = screen.getByRole("dialog", { name: "Novo contrato" });
    fireEvent.click(within(contractDialog).getByRole("button", { name: "Receber" }));
    const receiptDialog = screen.getByRole("dialog", { name: "Receber parcela" });
    fireEvent.change(within(receiptDialog).getByLabelText("Data de recebimento"), { target: { value: "2026-09-22" } });
    fireEvent.click(within(receiptDialog).getByRole("button", { name: "Confirmar recebimento" }));

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("settle_project_installment_receipt", expect.objectContaining({
      p_entry_id: "entry-1",
      p_financial_account_id: "account-1",
      p_amount_cents: 5000,
      p_settled_on: "2026-09-22",
      p_payment_method: "CASH",
      p_chart_account_id: "chart-1",
    })));
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("shows receipt date, method, account, and receiver on the contract finance card", () => {
    const installment = {
      id: "installment-1", organization_id: "org-1", engagement_id: "engagement-1", installment_number: 0,
      due_on: "2026-09-21", amount_cents: 5000, status: "PAID" as const, paid_at: "2026-09-22T12:00:00.000Z",
      financial_entry_id: "entry-1", settled_cents: 5000, remaining_cents: 0, last_paid_at: "2026-09-22",
      payment_method: "PIX", financial_account_id: "account-1", financial_account_name: "Caixa físico",
      received_by: "owner-1", received_by_name: "Julio Heiden",
    };
    render(<ProjectsManager {...data} projectId="project-1" installments={[installment]} />);

    fireEvent.click(screen.getByRole("button", { name: /Contratações/ }));
    fireEvent.click(screen.getByRole("button", { name: "Editar contratação de Cliente" }));
    const contractDialog = screen.getByRole("dialog", { name: "Novo contrato" });
    const receiptRow = within(contractDialog).getByText("PIX").closest("div");

    expect(receiptRow).toHaveTextContent("22 de set. de 2026");
    expect(receiptRow).toHaveTextContent("Caixa físico");
    expect(receiptRow).toHaveTextContent("Julio Heiden");
  });

  it("adiciona serviço interno usando o serviço e comissão do pacote e do responsável do quadro", async () => {
    mocks.rpc.mockResolvedValue({ data: { id: "internal-1", organization_id: "org-1", project_id: "project-1", engagement_id: "engagement-1", kanban_board_id: "board-1", package_assignment_id: "assignment-1", service_id: "service-1", service_name: "Datas Comemorativas", barber_id: "barber-1", commission_cents: 1000, delivery_on: "2026-09-22", status: "OPEN" }, error: null });
    render(<ProjectsManager {...internalServiceData} projectId="project-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Kanban/ }));
    fireEvent.doubleClick(screen.getByText("Cliente").closest("article") as HTMLElement);
    const eventDialog = screen.getByRole("dialog", { name: "Aguardando aceite" });
    expect(within(eventDialog).getByText("Alef Gonçalves")).toBeInTheDocument();
    fireEvent.click(within(eventDialog).getByRole("button", { name: "Adicionar Serviço Interno" }));
    const serviceDialog = screen.getByRole("dialog", { name: "Adicionar Serviço Interno" });
    expect(within(serviceDialog).getByRole("option", { name: /Datas Comemorativas/ })).toBeInTheDocument();
    expect(within(serviceDialog).queryByRole("option", { name: /Organização de arquivos/ })).not.toBeInTheDocument();
    fireEvent.change(within(serviceDialog).getByLabelText("Serviço interno"), { target: { value: "assignment-1" } });
    fireEvent.click(within(serviceDialog).getByRole("button", { name: "Adicionar serviço" }));
    fireEvent.change(within(eventDialog).getByLabelText("Entrega do serviço interno"), { target: { value: "2026-09-22" } });
    fireEvent.click(within(eventDialog).getByRole("button", { name: "Salvar serviço interno" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("upsert_project_engagement_internal_service", expect.objectContaining({
      p_organization_id: "org-1", p_project_id: "project-1", p_engagement_id: "engagement-1", p_board_id: "board-1",
      p_service_assignment_id: "assignment-1", p_commission_cents: 1000, p_delivery_on: "2026-09-22",
    })));
  });

  it("allows deleting an open internal service after confirmation", async () => {
    const existing = { id: "internal-1", organization_id: "org-1", project_id: "project-1", engagement_id: "engagement-1", internal_card_id: null, kanban_board_id: "board-1", package_assignment_id: "assignment-1", service_id: "service-1", service_name: "Datas Comemorativas", barber_id: "barber-1", commission_cents: 1000, delivery_on: "2026-09-22", status: "OPEN" as const, commission_ledger_entry_id: null };
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    render(<ProjectsManager {...internalServiceData} internalServices={[existing]} projectId="project-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Kanban/ }));
    fireEvent.doubleClick(screen.getByText("Cliente").closest("article") as HTMLElement);
    const eventDialog = screen.getByRole("dialog", { name: "Aguardando aceite" });
    fireEvent.click(within(eventDialog).getByRole("button", { name: "Excluir serviço interno" }));
    const confirmDialog = screen.getByRole("dialog", { name: "Excluir serviço interno" });
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "Excluir serviço" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("delete_project_engagement_internal_service", { p_organization_id: "org-1", p_id: "internal-1" }));
  });

  it("pede confirmação antes de concluir serviço interno e gerar comissão a pagar", async () => {
    const existing = { id: "internal-1", organization_id: "org-1", project_id: "project-1", engagement_id: "engagement-1", kanban_board_id: "board-1", package_assignment_id: "assignment-1", service_id: "service-1", service_name: "Datas Comemorativas", barber_id: "barber-1", commission_cents: 1000, delivery_on: "2026-09-22", status: "OPEN" as const, commission_ledger_entry_id: null };
    mocks.rpc.mockResolvedValue({ data: { ...existing, status: "COMPLETED" }, error: null });
    render(<ProjectsManager {...internalServiceData} internalServices={[existing]} projectId="project-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Kanban/ }));
    fireEvent.doubleClick(screen.getByText("Cliente").closest("article") as HTMLElement);
    const eventDialog = screen.getByRole("dialog", { name: "Aguardando aceite" });
    fireEvent.click(within(eventDialog).getByRole("button", { name: "Pagar serviço e gerar comissão" }));
    const confirmation = screen.getByRole("dialog", { name: "Confirmar geração de comissão" });
    expect(within(confirmation).getByText(/não realiza o pagamento agora/i)).toBeInTheDocument();
    fireEvent.click(within(confirmation).getByRole("button", { name: "Confirmar e concluir" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("complete_project_engagement_internal_service", expect.objectContaining({
      p_organization_id: "org-1", p_internal_service_id: "internal-1", p_idempotency_key: expect.any(String),
    })));
  });

  it("libera novo serviço para o mesmo cartão após conclusão no quadro anterior", () => {
    const movedEngagement = { ...internalServiceData.engagements[0], kanban_board_id: "board-2" };
    const completedPreviousBoard = { id: "internal-previous", organization_id: "org-1", project_id: "project-1", engagement_id: "engagement-1", kanban_board_id: "board-1", package_assignment_id: "assignment-1", service_id: "service-1", service_name: "Datas Comemorativas", barber_id: "barber-1", commission_cents: 1000, delivery_on: "2026-09-21", status: "COMPLETED" as const, commission_ledger_entry_id: "ledger-1" };
    render(<ProjectsManager {...internalServiceData} engagements={[movedEngagement]} internalServices={[completedPreviousBoard]} projectId="project-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Kanban/ }));
    fireEvent.doubleClick(screen.getByText("Cliente").closest("article") as HTMLElement);
    const eventDialog = screen.getByRole("dialog", { name: "Em execução" });
    expect(within(eventDialog).getByText("Serviço Interno")).toBeInTheDocument();
    expect(within(eventDialog).getByRole("button", { name: "Adicionar Serviço Interno" })).toBeEnabled();
  });
});
