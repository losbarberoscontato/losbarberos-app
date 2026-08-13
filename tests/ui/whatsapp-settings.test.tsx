import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WhatsAppSettings, type WhatsAppSettingsStatus } from "@/components/connected-manager/whatsapp-settings";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/connected-manager/mutation-utils", () => ({
  connectedClient: () => ({ rpc: vi.fn(() => Promise.resolve({ data: null, error: null })) }),
  assertResult: (result: unknown) => result,
  runMutation: async (_setMessage: unknown, mutation: () => Promise<unknown>) => { await mutation(); return true; },
}));

afterEach(() => cleanup());

const status: WhatsAppSettingsStatus = {
  connections: [],
  reminders: [
    { id: "r1", position: 1, enabled: true, offset_minutes: 360, template_key: "appointment_reminder_6h", language_code: "pt_BR" },
    { id: "r2", position: 2, enabled: true, offset_minutes: 45, template_key: "appointment_reminder_45m", language_code: "pt_BR" },
  ],
  automation: {
    confirmation_enabled: true,
    confirmation_template_key: "appointment_confirmation",
    welcome_enabled: true,
    welcome_message: "Olá {nome}, acesse {link}.",
  },
};

describe("WhatsApp settings", () => {
  it("exibe conexão híbrida por provedor e automações transacionais", () => {
    render(<WhatsAppSettings organizationId="org-1" organizationName="Barbearia Central" status={status} />);

    expect(screen.getByRole("heading", { name: "WhatsApp" })).toBeInTheDocument();
    expect(screen.getByText("Meta Cloud API")).toBeInTheDocument();
    expect(screen.getByText("QR Web")).toBeInTheDocument();
    expect(screen.getByText(/um canal fica ativo por vez/i)).toBeInTheDocument();
    expect(screen.getByText("Confirmação do agendamento")).toBeInTheDocument();
    expect(screen.getByText("Lembrete 6 horas antes")).toBeInTheDocument();
    expect(screen.getByText("Lembrete 45 minutos antes")).toBeInTheDocument();
    expect(screen.getByLabelText("Mensagem de boas-vindas")).toHaveValue("Olá {nome}, acesse {link}.");
  });

  it("não expõe campos de token ou segredo", () => {
    render(<WhatsAppSettings organizationId="org-1" organizationName="Barbearia Central" status={status} />);

    expect(screen.queryByLabelText(/token|secret|senha/i)).not.toBeInTheDocument();
    expect(screen.getAllByText(/credenciais ficam protegidas no servidor/i).length).toBeGreaterThan(0);
  });

  it("oferece atualizar status e lifecycle do canal conectado", () => {
    render(<WhatsAppSettings organizationId="org-1" organizationName="Barbearia Central" status={{
      ...status,
      connections: [{
        id: "meta-1",
        provider: "META_CLOUD",
        status: "CONNECTED",
        is_active: false,
        waba_id: "waba-1",
        phone_number_id: "phone-1",
        gateway_instance_id: null,
        connected_at: "2026-08-13T10:00:00Z",
        disconnected_at: null,
        last_error_code: null,
        last_status_at: "2026-08-13T10:00:00Z",
      }],
    }} />);

    expect(screen.getByRole("button", { name: /atualizar status/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /desconectar/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ativar|ativo/i })).toBeInTheDocument();
  });
});
