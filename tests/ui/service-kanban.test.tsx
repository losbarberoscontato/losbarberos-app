import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  organizationId: "org-1", manager: true, enabled: true,
  boards: [
    { id: "waiting", name: "Aguardando", position: 0, system_key: "WAITING", responsible_barber_id: null },
    { id: "doing", name: "Fazendo", position: 1, system_key: null, responsible_barber_id: "barber-2" },
  ],
  cards: [{ id: "card-1", board_id: "waiting", appointment_id: "appointment-1", customer_id: "customer-1", service_id: null, title: "Cliente Exemplo", origin_barber_id: "barber-1", responsible_barber_id: "barber-1", archived_at: null, created_at: "2026-10-20T00:00:00Z" }],
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

  it("cria card manual sem campos financeiros", async () => {
    render(<ServiceKanban data={data} />);
    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "Conferir fotos" } });
    fireEvent.change(screen.getByLabelText("Responsável", { selector: "select" }), { target: { value: "barber-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar card" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("create_manual_service_kanban_card", expect.objectContaining({ p_title: "Conferir fotos", p_responsible_barber_id: "barber-1" })));
  });
});
