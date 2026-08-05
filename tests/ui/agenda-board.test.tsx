import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgendaBoard } from "@/components/agenda-board";

vi.mock("@/components/manager-shell", () => ({
  useManagerBillingBlocked: () => false,
}));

describe("AgendaBoard date navigation", () => {
  beforeEach(() => {
    cleanup();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T12:00:00-03:00"));
  });

  it("avança e retorna um dia pela barra da agenda", () => {
    render(<AgendaBoard />);

    expect(screen.getByText("4 de agosto de 2026")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Próximo dia" })[0]);
    expect(screen.getByText("5 de agosto de 2026")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dia anterior" }));
    expect(screen.getByText("4 de agosto de 2026")).toBeInTheDocument();
  });

  it("não mostra compromissos do dia 4 em outra data", () => {
    render(<AgendaBoard />);

    expect(screen.getAllByText("Rafael Martins").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Próximo dia" })[0]);

    expect(screen.queryByText("Rafael Martins")).not.toBeInTheDocument();
    expect(screen.getByText(/Nenhum agendamento para este dia/i)).toBeInTheDocument();
  });

  it("abre calendário e permite selecionar uma data específica", () => {
    render(<AgendaBoard />);

    fireEvent.click(screen.getAllByRole("button", { name: /Selecionar data/i })[0]);
    const dateInput = screen.getByDisplayValue("2026-08-04");
    fireEvent.change(dateInput, { target: { value: "2026-08-18" } });

    expect(screen.getByText("18 de agosto de 2026")).toBeInTheDocument();
  });

  it("encontra cliente demo pelo nome ao criar agendamento", () => {
    render(<AgendaBoard />);

    fireEvent.click(screen.getByRole("button", { name: "Novo agendamento" }));
    fireEvent.change(screen.getByPlaceholderText(/Buscar por nome ou telefone/i), { target: { value: "Rafa" } });

    expect(screen.getByRole("button", { name: "Selecionar Rafael Martins" })).toBeInTheDocument();
  });

  it("salva novo agendamento demo na data e hora escolhidas", () => {
    render(<AgendaBoard />);

    fireEvent.click(screen.getByRole("button", { name: "Novo agendamento" }));
    fireEvent.change(screen.getByPlaceholderText(/Buscar por nome ou telefone/i), { target: { value: "Vinícius" } });
    fireEvent.click(screen.getByRole("button", { name: "Selecionar Vinícius Rocha" }));
    fireEvent.change(screen.getByLabelText("Data"), { target: { value: "2026-08-05" } });
    fireEvent.change(screen.getByLabelText("Horário"), { target: { value: "16:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar agendamento" }));

    expect(screen.getByText("5 de agosto de 2026")).toBeInTheDocument();
    expect(screen.getAllByText("Vinícius Rocha")).toHaveLength(1);
    expect(screen.getByText("16:30 — 17:15")).toBeInTheDocument();
  });
});
