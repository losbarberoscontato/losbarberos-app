import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DemoLogin } from "@/components/demo-login";

const mocks = vi.hoisted(() => ({
  getSupabaseBrowserClient: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  signInWithPassword: vi.fn(),
  signInWithOAuth: vi.fn(),
}));

vi.mock("@/lib/supabase/browser", () => ({
  getSupabaseBrowserClient: mocks.getSupabaseBrowserClient,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
}));

describe("entrada do sistema", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signInWithOAuth.mockResolvedValue({ data: { provider: "google" }, error: null });
    mocks.signInWithPassword.mockResolvedValue({ data: { user: { id: "user-id" } }, error: null });
    mocks.getSupabaseBrowserClient.mockReturnValue({
      auth: {
        signInWithOAuth: mocks.signInWithOAuth,
        signInWithPassword: mocks.signInWithPassword,
      },
    });
  });

  it("entra como gestor sem expor seleção de perfis", async () => {
    render(<DemoLogin initialMode="signin" nextPath="/gestor" />);

    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Entre na sua barbearia" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continuar com Google" }));

    await waitFor(() => expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "http://localhost:3000/auth/callback?next=%2Fgestor&provider=google",
      },
    }));
  });

  it("abre cadastro do hotsite e envia primeiro acesso ao onboarding", async () => {
    render(<DemoLogin initialMode="signup" nextPath="/gestor" />);

    expect(screen.getByRole("heading", { name: "Crie sua barbearia" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continuar com Google" }));

    await waitFor(() => expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "http://localhost:3000/auth/callback?next=%2Fonboarding&provider=google",
      },
    }));
  });

  it("preserva destino protegido e deixa o guard decidir o perfil real", async () => {
    render(<DemoLogin initialMode="signin" nextPath="/admin" />);

    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "admin@example.com" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "senha-segura" } });
    fireEvent.submit(screen.getByRole("form"));

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/admin"));
  });

  it("troca modo sem perder destino protegido", () => {
    render(<DemoLogin initialMode="signin" nextPath="/admin" />);

    fireEvent.click(screen.getByRole("button", { name: "Ainda não tenho conta. Criar conta" }));

    expect(mocks.replace).toHaveBeenCalledWith(
      "/entrar?modo=cadastro&next=%2Fadmin",
      { scroll: false },
    );
  });
});
