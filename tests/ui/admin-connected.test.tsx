import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminControlPlane } from "@/components/connected-admin/control-plane";
import type { AdminControlPlaneData } from "@/components/connected-admin/types";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/supabase/browser", () => ({
  getSupabaseBrowserClient: () => ({ rpc: mocks.rpc }),
}));

const data: AdminControlPlaneData = {
  organizations: [
    { id: "11111111-1111-4111-8111-111111111111", name: "Barbearia Ativa", slug: "barbearia-ativa", timezone: "America/Sao_Paulo", currency: "BRL", created_at: "2026-07-01T12:00:00Z" },
    { id: "22222222-2222-4222-8222-222222222222", name: "Barbearia Bloqueada", slug: "barbearia-bloqueada", timezone: "America/Sao_Paulo", currency: "BRL", created_at: "2026-07-02T12:00:00Z" },
  ],
  subscriptions: [
    { id: "sub-1", organization_id: "11111111-1111-4111-8111-111111111111", stripe_price_id: "price_real", status: "ACTIVE", trial_ends_at: null, current_period_ends_at: "2026-09-01T12:00:00Z", grace_ends_at: null, canceled_at: null, retention_ends_at: null, updated_at: "2026-08-01T12:00:00Z" },
    { id: "sub-2", organization_id: "22222222-2222-4222-8222-222222222222", stripe_price_id: "price_real", status: "BLOCKED", trial_ends_at: "2026-07-20T12:00:00Z", current_period_ends_at: "2026-08-01T12:00:00Z", grace_ends_at: null, canceled_at: null, retention_ends_at: null, updated_at: "2026-08-02T12:00:00Z" },
  ],
  accessEvents: [
    { id: 1, organization_id: "22222222-2222-4222-8222-222222222222", from_status: "GRACE", to_status: "BLOCKED", reason: "Carência encerrada", created_at: "2026-08-02T12:00:00Z" },
  ],
  errors: [],
  loadedAt: "2026-08-04T12:00:00Z",
  accessEventLimit: 500,
};

describe("connected platform admin", () => {
  afterEach(cleanup);

  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.refresh.mockReset();
    mocks.rpc.mockResolvedValue({ data: {}, error: null });
  });

  it("lista somente tenants, billing e auditoria reais sem inventar MRR", () => {
    render(<AdminControlPlane data={data} />);
    expect(screen.getAllByText("Barbearia Ativa").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Barbearia Bloqueada").length).toBeGreaterThan(0);
    expect(screen.getByText("Carência encerrada")).toBeInTheDocument();
    expect(screen.getByText("MRR não calculado")).toBeInTheDocument();
    expect(screen.queryByText("R$ 16.980")).not.toBeInTheDocument();
  });

  it("filtra por status e mostra zero state", () => {
    render(<AdminControlPlane data={data} />);
    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "BLOCKED" } });
    expect(within(screen.getByRole("table")).queryByText("Barbearia Ativa")).not.toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("Barbearia Bloqueada")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Buscar tenant"), { target: { value: "inexistente" } });
    expect(screen.getByText("Nenhuma organização encontrada")).toBeInTheDocument();
  });

  it("mostra estado vazio real", () => {
    render(<AdminControlPlane data={{ ...data, organizations: [], subscriptions: [], accessEvents: [] }} />);
    expect(screen.getByText("Nenhuma organização encontrada")).toBeInTheDocument();
    expect(screen.getByText("Nenhum evento de acesso")).toBeInTheDocument();
  });

  it("mostra erro total e permite tentar novamente", () => {
    render(<AdminControlPlane data={{ ...data, organizations: [], subscriptions: [], accessEvents: [], errors: ["Falha ao consultar organizações.", "Falha ao consultar assinaturas.", "Falha ao consultar auditoria de acesso."] }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Control plane indisponível");
    expect(screen.queryByLabelText("Resumo de tenants")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("bloqueia via RPC auditada e exige motivo", async () => {
    render(<AdminControlPlane data={data} />);
    fireEvent.click(screen.getByRole("button", { name: "Bloquear acesso de Barbearia Ativa" }));
    const confirm = screen.getByRole("button", { name: "Confirmar e auditar" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Motivo obrigatório"), { target: { value: "  suspeita operacional  " } });
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("set_platform_organization_access_status", {
      p_organization_id: "11111111-1111-4111-8111-111111111111",
      p_status: "BLOCKED",
      p_reason: "suspeita operacional",
    }));
    expect(await screen.findByRole("status")).toHaveTextContent("acesso alterado para Bloqueada");
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("reativa tenant bloqueado pela mesma RPC auditada", async () => {
    render(<AdminControlPlane data={data} />);
    fireEvent.click(screen.getByRole("button", { name: "Reativar acesso de Barbearia Bloqueada" }));
    fireEvent.change(screen.getByLabelText("Motivo obrigatório"), { target: { value: "Pagamento conciliado" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar e auditar" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("set_platform_organization_access_status", {
      p_organization_id: "22222222-2222-4222-8222-222222222222",
      p_status: "ACTIVE",
      p_reason: "Pagamento conciliado",
    }));
    expect(await screen.findByRole("status")).toHaveTextContent("acesso alterado para Ativa");
  });

  it("mantém diálogo e mostra erro seguro quando RPC falha", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "internal provider detail" } });
    render(<AdminControlPlane data={data} />);
    fireEvent.click(screen.getByRole("button", { name: "Reativar acesso de Barbearia Bloqueada" }));
    fireEvent.change(screen.getByLabelText("Motivo obrigatório"), { target: { value: "Conciliação aprovada" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar e auditar" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Não foi possível alterar o acesso");
    expect(alert).not.toHaveTextContent("internal provider detail");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
