import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ManagerShell } from "@/components/manager-shell";

const mocks = vi.hoisted(() => ({
  getSupabaseBrowserClient: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/gestor/configuracoes",
  useRouter: () => ({ refresh: mocks.refresh, replace: mocks.replace }),
}));

vi.mock("@/lib/supabase/browser", () => ({
  getSupabaseBrowserClient: mocks.getSupabaseBrowserClient,
}));

describe("manager logout", () => {
  beforeEach(() => {
    cleanup();
    mocks.getSupabaseBrowserClient.mockReset();
    mocks.signOut.mockReset();
    mocks.getSupabaseBrowserClient.mockReturnValue({ auth: { signOut: mocks.signOut } });
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.refresh.mockReset();
    mocks.replace.mockReset();
  });

  it("ends only the local Supabase session and returns to login", async () => {
    render(<ManagerShell userName="Gestor conectado">conteúdo</ManagerShell>);

    fireEvent.click(screen.getByRole("button", { name: "Sair da conta" }));

    await waitFor(() => {
      expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
      expect(mocks.replace).toHaveBeenCalledWith("/entrar");
    });
  });

  it("does not access Supabase in demo mode", async () => {
    render(<ManagerShell demoMode>conteúdo</ManagerShell>);

    fireEvent.click(screen.getByRole("button", { name: "Sair da conta" }));

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/entrar"));
    expect(mocks.getSupabaseBrowserClient).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("keeps the user on the manager screen when Supabase rejects logout", async () => {
    mocks.signOut.mockResolvedValue({ error: { message: "network error" } });
    render(<ManagerShell>conteúdo</ManagerShell>);

    fireEvent.click(screen.getByRole("button", { name: "Sair da conta" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível sair");
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sair da conta" })).toBeEnabled();
  });
});
