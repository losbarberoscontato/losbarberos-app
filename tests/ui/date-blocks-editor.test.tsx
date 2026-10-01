import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DateBlocksEditor } from "@/components/connected-manager/date-blocks-editor";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/components/connected-manager/mutation-utils", () => ({
  connectedClient: () => ({ rpc: mocks.rpc }),
  assertResult: (result: { error: { message: string } | null }) => { if (result.error) throw new Error(result.error.message); },
  runMutation: async (setMessage: (message: string) => void, mutation: () => Promise<void>, success: string) => {
    try { await mutation(); setMessage(success); return true; }
    catch (error) { setMessage(error instanceof Error ? error.message : "Erro"); return false; }
  },
}));

beforeEach(() => { mocks.rpc.mockReset().mockResolvedValue({ error: null, data: "block-1" }); mocks.refresh.mockReset(); });

describe("editor de bloqueios de datas", () => {
  it("salva feriado permanente com abrangência e data escolhida", async () => {
    const year = Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "America/Sao_Paulo" }).format(new Date()));
    render(<DateBlocksEditor organizationId="org-1" timezone="America/Sao_Paulo" blocks={[]} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: `1 de janeiro de ${year}` }));
    fireEvent.change(screen.getByLabelText("Nome do feriado"), { target: { value: "Aniversário da cidade" } });
    fireEvent.change(screen.getByLabelText("Abrangência"), { target: { value: "MUNICIPAL" } });
    fireEvent.change(screen.getByLabelText("Tipo de feriado"), { target: { value: "ANNUAL" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("save_organization_date_block", expect.objectContaining({
      p_organization_id: "org-1", p_id: null, p_block_type: "HOLIDAY", p_name: "Aniversário da cidade",
      p_holiday_scope: "MUNICIPAL", p_recurrence: "ANNUAL", p_start_date: `${year}-01-01`, p_end_date: null,
    })));
    expect(mocks.refresh).toHaveBeenCalledOnce();
  }, 20_000);

  it("edita descrição e intervalo horário de evento existente", async () => {
    const block = {
      id: "event-1", organization_id: "org-1", block_type: "EVENT" as const, name: "Evento",
      description: "Equipe reunida", holiday_scope: null, recurrence: null, start_date: "2026-10-05",
      end_date: null, start_time: "10:00:00", end_time: "11:00:00",
    };
    render(<DateBlocksEditor organizationId="org-1" timezone="America/Sao_Paulo" blocks={[block]} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /5 de outubro de 2026, Evento · Evento/ }));
    fireEvent.change(screen.getByLabelText("Hora de início"), { target: { value: "13:30" } });
    fireEvent.change(screen.getByLabelText("Hora de fim"), { target: { value: "15:00" } });
    fireEvent.change(screen.getByLabelText("Descrição"), { target: { value: "Evento interno" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("save_organization_date_block", expect.objectContaining({
      p_id: "event-1", p_block_type: "EVENT", p_start_date: "2026-10-05", p_start_time: "13:30", p_end_time: "15:00", p_description: "Evento interno",
    })));
  }, 20_000);

  it("exclui bloqueio existente por sua identidade", async () => {
    const block = {
      id: "recess-1", organization_id: "org-1", block_type: "RECESS" as const, name: "Férias",
      description: null, holiday_scope: null, recurrence: null, start_date: "2026-10-10",
      end_date: "2026-10-12", start_time: null, end_time: null,
    };
    render(<DateBlocksEditor organizationId="org-1" timezone="America/Sao_Paulo" blocks={[block]} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /10 de outubro de 2026, Recesso · Férias/ }));
    fireEvent.click(screen.getByRole("button", { name: "Excluir bloqueio" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("delete_organization_date_block", { p_organization_id: "org-1", p_id: "recess-1" }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
  }, 20_000);
});
