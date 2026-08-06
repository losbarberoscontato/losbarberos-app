import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTION_MESSAGE_TIMEOUT_MS, ActionMessage } from "@/components/connected-manager/shared";

describe("ActionMessage", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("desaparece depois do tempo padrão", () => {
    vi.useFakeTimers();
    render(<ActionMessage message="Serviço inativado." />);
    expect(screen.getByRole("status")).toHaveTextContent("Serviço inativado.");
    act(() => vi.advanceTimersByTime(ACTION_MESSAGE_TIMEOUT_MS - 1));
    expect(screen.getByRole("status")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
