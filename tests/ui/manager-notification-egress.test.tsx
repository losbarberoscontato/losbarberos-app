import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagerShell } from "@/components/manager-shell";

const mocks = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("@/lib/supabase/browser", () => ({ getSupabaseBrowserClient: mocks.client }));
vi.mock("next/navigation", () => ({ usePathname: () => "/gestor", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

describe("notificações do gestor sem polling sobreposto", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("mantém 30s, não sobrepõe consulta lenta e descarta resposta do tenant anterior", async () => {
    vi.useFakeTimers();
    const pending: { org: string; resolve: (value: unknown) => void }[] = [];
    mocks.client.mockReturnValue({ from: () => {
      let org = "";
      const query = {
        select: () => query, is: () => query, order: () => query,
        eq: (_key: string, value: string) => { org = value; return query; },
        limit: () => new Promise((resolve) => pending.push({ org, resolve })),
      };
      return query;
    } });
    const view = render(<ManagerShell organizationId="tenant-a">Conteúdo</ManagerShell>);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(pending).toHaveLength(1);
    view.rerender(<ManagerShell organizationId="tenant-b">Conteúdo</ManagerShell>);
    expect(pending.map((request) => request.org)).toEqual(["tenant-a", "tenant-b"]);
    await act(async () => {
      pending[1].resolve({ data: [{ id: "b", title: "Aviso atual", body: "", href: "/gestor", read_at: null, created_at: "2026-11-03" }] });
      pending[0].resolve({ data: [{ id: "a", title: "Aviso antigo", body: "", href: "/gestor", read_at: null, created_at: "2026-11-03" }] });
    });
    fireEvent.click(screen.getByRole("button", { name: "Notificações" }));
    expect(screen.getByText("Aviso atual")).toBeInTheDocument();
    expect(screen.queryByText("Aviso antigo")).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(pending).toHaveLength(3);
    view.unmount();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pending).toHaveLength(3);
  });
});
