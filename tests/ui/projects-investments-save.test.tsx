import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectsManager } from "@/components/connected-manager/projects-manager";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock("@/components/connected-manager/mutation-utils", () => ({
  connectedClient: () => ({ rpc: mocks.rpc }),
  assertResult: async (result: { error: unknown }) => { if (result.error) throw new Error(String(result.error)); },
  runMutation: async (_setMessage: unknown, mutation: () => Promise<void>) => { await mutation(); return true; },
}));

const data = {
  organizationId: "org-1",
  enabled: true,
  retentionStatus: "NONE" as const,
  projects: [{ id: "project-1", organization_id: "org-1", name: "Projeto Natal 2026", description: null, status: "PUBLISHED" as const, starts_on: null, sales_close_on: null, ends_on: null, goal_contracts: 10, created_at: "2026-09-15T00:00:00.000Z" }],
  packages: [], steps: [], engagements: [], installments: [], customers: [], services: [], barbers: [], packageBarbers: [], costItems: [], kanbanBoards: [],
};

describe("projects investments persistence", () => {
  it("refreshes the project after adding an investment", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { id: "cost-1", organization_id: "org-1", project_id: "project-1", kind: "INVESTMENT", name: "Cenário", description: "Montagem", amount_cents: 25000, active: true, sort_order: 1, created_at: "2026-09-15T00:00:00.000Z" }, error: null });
    render(<ProjectsManager {...data} projectId="project-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Investimentos/ }));
    fireEvent.change(screen.getByLabelText("Item / descrição"), { target: { value: "Cenário" } });
    fireEvent.change(screen.getByLabelText("Categoria"), { target: { value: "INVESTMENT" } });
    fireEvent.change(screen.getByLabelText("Valor (R$)"), { target: { value: "250,00" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    expect(await screen.findByText("Cenário")).toBeInTheDocument();
    expect(mocks.rpc).toHaveBeenCalledWith("upsert_project_cost_item", expect.objectContaining({ p_kind: "INVESTMENT", p_amount_cents: 25000 }));
    expect(mocks.refresh).toHaveBeenCalled();
  });
});
