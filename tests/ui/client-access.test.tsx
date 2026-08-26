import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ClientAccessPage from "@/app/acesso-cliente/page";

describe("entrada pública de cliente", () => {
  it("mantém a página pública fora do painel e abre cada modo do fluxo normal", () => {
    render(<ClientAccessPage />);

    expect(screen.getByRole("heading", { name: "Seus horários, no seu ritmo." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Entrar" })).toHaveAttribute("href", "/cliente/entrar?modo=login");
    expect(screen.getByRole("link", { name: "Fazer cadastro" })).toHaveAttribute("href", "/cliente/entrar?modo=cadastro");
    expect(screen.queryByText(/agendamentos, fila/i)).not.toBeInTheDocument();
  });
});
