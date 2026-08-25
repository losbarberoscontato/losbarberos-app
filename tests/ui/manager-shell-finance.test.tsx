import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ManagerShell } from "@/components/manager-shell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/gestor/financeiro/caixa",
  useRouter: () => ({ replace: vi.fn() }),
}));

describe("manager finance navigation", () => {
  beforeEach(cleanup);

  it("expands Financeiro and marks Caixa as current section", () => {
    render(<ManagerShell>conteúdo</ManagerShell>);
    expect(screen.getByRole("link", { name: "Financeiro" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Caixa" })[0]).toHaveAttribute("aria-current", "page");
  });
});
