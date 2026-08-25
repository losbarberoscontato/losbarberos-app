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
    expect(screen.getByRole("link", { name: /Testar agora/i })).toHaveAttribute(
      "href",
      "/entrar?modo=cadastro",
    );
    expect(screen.getAllByRole("link", { name: /Começar/i })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({}),
      ]),
    );
    for (const link of screen.getAllByRole("link", { name: /Começar/i })) {
      expect(link).toHaveAttribute("href", "/entrar?modo=cadastro");
    }
  });
});
