import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "@/app/page";

describe("atalhos do hotsite para entrada", () => {
  it("separa login de CTAs de cadastro", () => {
    render(<HomePage />);

    expect(screen.getByRole("link", { name: "Entrar" })).toHaveAttribute(
      "href",
      "/entrar?modo=login",
    );
    for (const link of screen.getAllByRole("link", { name: /Entrar no painel/i })) {
      expect(link).toHaveAttribute("href", "/entrar?modo=login");
    }
    const registrationLinks = screen.getAllByRole("link", { name: /Começar|Criar minha barbearia/i });
    expect(registrationLinks).not.toHaveLength(0);
    for (const link of registrationLinks) {
      expect(link).toHaveAttribute("href", "/entrar?modo=cadastro");
    }
    expect(screen.queryByRole("link", { name: /cliente|agendar/i })).not.toBeInTheDocument();
  });
});
