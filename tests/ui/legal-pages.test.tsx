import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import HomePage from "@/app/page";
import DataDeletionPage from "@/app/exclusao-de-dados/page";
import PrivacyPage from "@/app/privacidade/page";
import TermsPage from "@/app/termos/page";

afterEach(cleanup);

const legalName = "JULIO CESAR HEIDEN JUNIOR 05128841960";
const privacyEmail = "contato@losbarberos.com.br";

describe("public legal pages", () => {
  it("publishes a complete privacy notice with controller contact and LGPD rights", () => {
    render(<PrivacyPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Política de Privacidade" })).toBeInTheDocument();
    expect(screen.getByText(legalName)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: privacyEmail })).toSatisfy((links: HTMLElement[]) =>
      links.every((link) => link.getAttribute("href") === `mailto:${privacyEmail}`),
    );
    expect(screen.getByText(/controlador dos dados próprios da plataforma/i)).toBeInTheDocument();
    expect(screen.getByText(/operador quando tratar dados pessoais em nome das barbearias/i)).toBeInTheDocument();
    expect(screen.getByText(/confirmação da existência de tratamento/i)).toBeInTheDocument();
    expect(screen.getByText(/cookies estritamente necessários/i)).toBeInTheDocument();
  });

  it("publishes terms that define tenant responsibilities and Brazilian law", () => {
    render(<TermsPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Termos de Uso" })).toBeInTheDocument();
    expect(screen.getByText(/possuir base legal adequada/i)).toBeInTheDocument();
    expect(screen.getByText(/legislação brasileira/i)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: privacyEmail })).toSatisfy((links: HTMLElement[]) =>
      links.every((link) => link.getAttribute("href") === `mailto:${privacyEmail}`),
    );
  });

  it("publishes two clear data deletion paths and retention exceptions", () => {
    render(<DataDeletionPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Exclusão de Dados" })).toBeInTheDocument();
    expect(screen.getByText(/Perfil e privacidade/i)).toBeInTheDocument();
    expect(screen.getByText(/Solicitar exclusão/i)).toBeInTheDocument();
    expect(screen.getByText(/Solicitação de exclusão de dados/i)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: privacyEmail })).toSatisfy((links: HTMLElement[]) =>
      links.every((link) => link.getAttribute("href") === `mailto:${privacyEmail}`),
    );
    expect(screen.getByText(/obrigação legal ou regulatória/i)).toBeInTheDocument();
  });

  it("links all legal documents from the public footer", () => {
    render(<HomePage />);

    expect(screen.getByRole("link", { name: "Privacidade" })).toHaveAttribute("href", "/privacidade");
    expect(screen.getByRole("link", { name: "Termos de uso" })).toHaveAttribute("href", "/termos");
    expect(screen.getByRole("link", { name: "Exclusão de dados" })).toHaveAttribute("href", "/exclusao-de-dados");
  });
});
