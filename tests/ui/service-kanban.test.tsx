import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceKanban } from "@/components/service-kanban";
import type { ServiceKanbanData } from "@/lib/service-kanban-server";

const refresh = vi.fn();
const rpc = vi.fn(() => Promise.resolve({ data: {}, error: null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/connected-manager/mutation-utils", () => ({
  connectedClient: () => ({ rpc }),
  assertResult: async (result: { error: Error | null }) => { if (result.error) throw result.error; },
  runMutation: async (_setMessage: unknown, mutation: () => Promise<unknown>) => { await mutation(); return true; },
}));

const data: ServiceKanbanData = {
  organizationId: "org-1", actorUserId: "user-1", manager: true, enabled: true,
  boards: [
    { id: "waiting", name: "Aguardando", position: 0, system_key: "WAITING", responsible_barber_id: null },
    { id: "doing", name: "Fazendo", position: 1, system_key: null, responsible_barber_id: "barber-2" },
  ],
  cards: [{ id: "card-1", board_id: "waiting", appointment_id: "appointment-1", customer_id: "customer-1", service_id: null, title: "Cliente Exemplo", description: "Descrição salva", due_on: "2026-10-25", received_at: "2026-10-20T10:30:00Z", received_by_name: "Ana", origin_barber_id: "barber-1", responsible_barber_id: "barber-1", archived_at: null, created_at: "2026-10-20T00:00:00Z" }],
  comments: [{ id: "comment-1", card_id: "card-1", body: "Confirmar referência com cliente.", author_user_id: "user-1", author_name: "Ana", created_at: "2026-10-20T11:00:00Z", updated_at: "2026-10-20T11:00:00Z" }],
  links: [{ id: "link-1", card_id: "card-1", label: "Referência", url: "https://example.com", created_by_user_id: "user-1", created_by_role: "OWNER", created_at: "2026-10-20T11:00:00Z" }],
  barbers: [{ id: "barber-1", display_name: "Ana" }, { id: "barber-2", display_name: "Bruno" }],
  customers: [{ id: "customer-1", full_name: "Cliente Exemplo" }], services: [],
};

describe("Kanban de atendimentos", () => {
  beforeEach(() => { cleanup(); rpc.mockClear(); refresh.mockClear(); });

  it("oculta o quadro inteiro quando o módulo está inativo", () => {
    render(<ServiceKanban data={{ ...data, enabled: false }} />);
    expect(screen.queryByText("Cliente Exemplo")).not.toBeInTheDocument();
    expect(screen.getByText(/Ative o módulo em Configurações/)).toBeInTheDocument();
  });

  it("exige confirmação antes de concluir e não altera o atendimento", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<ServiceKanban data={data} />);
    fireEvent.click(screen.getByRole("button", { name: "Concluir" }));
    expect(rpc).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Concluir" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("mutate_service_kanban_card", expect.objectContaining({ p_card_id: "card-1", p_action: "COMPLETED" })));
    expect(rpc).not.toHaveBeenCalledWith("transition_appointment", expect.anything());
    confirm.mockRestore();
  });

  it("abre detalhes por duplo clique, mostra os campos do Kanban de Projetos e remove editar título do card", async () => {
    render(<ServiceKanban data={data} />);
    const card = screen.getAllByText("Cliente Exemplo").find((element) => element.tagName === "STRONG")?.closest("article");
    expect(card).not.toBeNull();
    expect(within(card!).getByText("Último comentário")).toBeInTheDocument();
    expect(within(card!).getByLabelText("Data prazo de Cliente Exemplo")).toHaveValue("2026-10-25");
    expect(within(card!).queryByText("Mover para")).not.toBeInTheDocument();
    expect(within(card!).queryByRole("combobox", { name: "Mover Cliente Exemplo" })).not.toBeInTheDocument();
    fireEvent.change(within(card!).getByLabelText("Data prazo de Cliente Exemplo"), { target: { value: "2026-10-27" } });
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("save_service_kanban_card_details", expect.objectContaining({ p_card_id: "card-1", p_due_on: "2026-10-27" })));
    fireEvent.doubleClick(card!);
    const dialog = screen.getByRole("dialog", { name: "Detalhes do card · Cliente Exemplo" });
    expect(within(dialog).getByLabelText("Data recebido")).toHaveTextContent("20 de out. de 2026, 07:30");
    expect(within(dialog).getByLabelText("Data prazo")).toHaveValue("2026-10-25");
    expect(within(dialog).getByLabelText("Descrição")).toHaveValue("Descrição salva");
    expect(within(dialog).getByLabelText("Cliente")).toHaveValue("Cliente Exemplo");
    expect(within(dialog).getByLabelText("Link 1 - Título")).toHaveValue("Referência");
    expect(within(dialog).getByText("Confirmar referência com cliente.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar título" })).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Descrição"), { target: { value: "Orientar a equipe." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar card" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("save_service_kanban_card_details", expect.objectContaining({ p_card_id: "card-1", p_description: "Orientar a equipe." })));
    fireEvent.change(within(dialog).getByLabelText("Link 1 - Título"), { target: { value: "Briefing" } });
    fireEvent.change(within(dialog).getByLabelText("Link 1 - URL"), { target: { value: "https://briefing.example" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar links" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("save_service_kanban_card_links", expect.objectContaining({ p_card_id: "card-1", p_links: [expect.objectContaining({ label: "Briefing", url: "https://briefing.example" })] })));
    fireEvent.change(within(dialog).getByLabelText("Adicionar comentário"), { target: { value: "Nova atualização" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Adicionar comentário" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("save_service_kanban_card_comment", expect.objectContaining({ p_card_id: "card-1", p_body: "Nova atualização" })));
  });

  it("edita título de card manual dentro dos detalhes", async () => {
    const manual = { ...data, cards: [{ ...data.cards[0], id: "manual-1", appointment_id: null, customer_id: null, title: "Card avulso" }], comments: [], links: [] };
    render(<ServiceKanban data={manual} />);
    fireEvent.doubleClick(screen.getByText("Card avulso").closest("article")!);
    const dialog = screen.getByRole("dialog", { name: "Detalhes do card · Card avulso" });
    fireEvent.change(within(dialog).getByLabelText("Título"), { target: { value: "Novo título" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar card" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("save_service_kanban_card_details", expect.objectContaining({ p_card_id: "manual-1", p_title: "Novo título" })));
  });

  it("abre o cadastro de card manual pelo botão e não exibe formulário fixo", async () => {
    render(<ServiceKanban data={data} />);
    expect(screen.queryByLabelText("Título")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Criar Card" }));
    const dialog = screen.getByRole("dialog", { name: "Criar card manual" });
    fireEvent.change(within(dialog).getByLabelText("Título"), { target: { value: "Conferir fotos" } });
    fireEvent.change(within(dialog).getByLabelText("Descrição"), { target: { value: "Separar as fotos escolhidas pelo cliente." } });
    fireEvent.change(within(dialog).getByLabelText("Responsável"), { target: { value: "barber-1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Criar card" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("create_manual_service_kanban_card", expect.objectContaining({ p_title: "Conferir fotos", p_description: "Separar as fotos escolhidas pelo cliente.", p_responsible_barber_id: "barber-1" })));
    expect(screen.getByText("Descrição salva")).toBeInTheDocument();
  });

  it("cria quadro pelo modo de edição, em diálogo", async () => {
    render(<ServiceKanban data={data} />);
    expect(screen.queryByRole("button", { name: "Adicionar quadro" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Editar Quadro" }));
    fireEvent.click(screen.getByRole("button", { name: "Adicionar quadro" }));
    const dialog = screen.getByRole("dialog", { name: "Adicionar quadro" });
    expect(within(dialog).getByLabelText("Responsável (opcional)")).toHaveValue("");
    fireEvent.change(within(dialog).getByLabelText("Nome"), { target: { value: "Em revisão" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Adicionar quadro" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("save_service_kanban_board", expect.objectContaining({ p_board_id: null, p_name: "Em revisão", p_responsible_barber_id: null })));
  });
});
