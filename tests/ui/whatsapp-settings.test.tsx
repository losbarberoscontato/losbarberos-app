import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WhatsAppSettings, type WhatsAppSettingsStatus } from "@/components/connected-manager/whatsapp-settings";

const { invokeMock, rpcMock } = vi.hoisted(() => ({ invokeMock: vi.fn(), rpcMock: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/connected-manager/mutation-utils", () => ({
  connectedClient: () => ({
    rpc: rpcMock,
    functions: { invoke: invokeMock },
  }),
  assertResult: (result: unknown) => result,
  runMutation: async (_setMessage: unknown, mutation: () => Promise<unknown>) => { await mutation(); return true; },
}));

beforeEach(() => {
  invokeMock.mockResolvedValue({ data: { state: "open" }, error: null });
  rpcMock.mockResolvedValue({ data: null, error: null });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const status: WhatsAppSettingsStatus = {
  connections: [],
  managerNotification: {
    phoneE164: null,
    matchesQrPhone: false,
  },
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
        id: "qr-1",
        provider: "QR_WEB",
        status: "CONNECTED",
        is_active: false,
        waba_id: null,
        phone_number_id: null,
        gateway_instance_id: "lb-test",
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

  it("permite configurar um número separado para avisos do gestor e alerta se ele coincide com o QR", () => {
    render(<WhatsAppSettings organizationId="org-1" organizationName="Barbearia Central" status={{
      ...status,
      managerNotification: {
        phoneE164: "+5547999999999",
        matchesQrPhone: true,
      },
    }} />);

    expect(screen.getByLabelText("WhatsApp para avisos do gestor")).toHaveValue("+5547999999999");
    expect(screen.getByText("Número igual ao da API, poderá ter problemas de envio/recebimento de mensagens no futuro.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar número de avisos" })).toBeInTheDocument();
  });

  it("mantém o painel acessível enquanto o retorno remoto ainda não contém o bloco de avisos", () => {
    render(<WhatsAppSettings organizationId="org-1" organizationName="Barbearia Central" status={{
      ...status,
      managerNotification: undefined as unknown as WhatsAppSettingsStatus["managerNotification"],
    }} />);

    expect(screen.getByLabelText("WhatsApp para avisos do gestor")).toHaveValue("");
  });

  it("confirma no card o número efetivamente persistido", async () => {
    rpcMock.mockResolvedValueOnce({
      data: { phone_e164: "+5547999999999", matches_qr_phone: false },
      error: null,
    });
    render(<WhatsAppSettings organizationId="org-1" organizationName="Barbearia Central" status={status} />);

    fireEvent.change(screen.getByLabelText("WhatsApp para avisos do gestor"), { target: { value: "47999999999" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar número de avisos" }));

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("save_whatsapp_v2_manager_notification_phone", {
      p_organization_id: "org-1",
      p_phone: "+5547999999999",
    }));
    expect(await screen.findByText("Número salvo: +5547999999999")).toBeInTheDocument();
  });

  it("inicia verificação automática depois que um QR está disponível", async () => {
    render(<WhatsAppSettings organizationId="org-1" organizationName="Barbearia Central" status={{
      ...status,
      connections: [{
        id: "qr-1",
        provider: "QR_WEB",
        status: "WAITING_FOR_QR",
        is_active: true,
        waba_id: null,
        phone_number_id: null,
        gateway_instance_id: "lb-test",
        connected_at: null,
        disconnected_at: null,
        last_error_code: null,
        last_status_at: "2026-08-16T19:00:00Z",
        health_status: "WAITING_FOR_QR",
        health_checked_at: "2026-08-16T19:00:00Z",
        health_error_code: null,
        qr_code: "x".repeat(120),
        qr_expires_at: "2026-08-16T19:05:00Z",
      }],
    }} />);

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("whatsapp-qr-status", { body: { organizationId: "org-1" } }));
    expect(await screen.findByText(/Evolution confirmou WhatsApp conectado/i)).toBeInTheDocument();
  });
});
