import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WhatsAppSettings, type WhatsAppSettingsStatus } from "@/components/connected-manager/whatsapp-settings";
import { getWhatsAppProductCopy, localizeWhatsAppCopy } from "@/components/connected-manager/whatsapp-product-copy";

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
  automation: {
    booking_client_enabled: true,
    booking_staff_enabled: true,
    reminder_t24_enabled: false,
    reminder_morning_enabled: true,
    reminder_t180_enabled: false,
    reminder_t45_enabled: true,
    custom_messages: [],
  },
};

describe("WhatsApp settings", () => {
  it("libera personalizadas apenas com runtime pronto e persiste escolhas", async () => {
    render(<WhatsAppSettings organizationId="org-1" organizationName="Barbearia Central" status={{ ...status, runtime: { ready: true, pending: 2, failed: 1 } }} />);
    expect(screen.queryByText("FUNÇÃO EM BREVE")).not.toBeInTheDocument();
    const toggle = screen.getByLabelText("Ativar 14 dias após o serviço");
    expect(toggle).toBeEnabled();
    fireEvent.click(toggle);
    fireEvent.change(screen.getByLabelText("Texto de 14 dias após o serviço"), { target: { value: "Olá {cliente}, vamos agendar?" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar automações" }));
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    expect(JSON.stringify(rpcMock.mock.calls)).toContain("Olá {cliente}, vamos agendar?");
    expect(screen.getByText(/Mensagens pendentes: 2/)).toHaveAttribute("role", "status");
  });

  it("exibe somente WhatsApp Web e automações transacionais", () => {
    render(<WhatsAppSettings organizationId="org-1" organizationName="Barbearia Central" status={status} />);

    expect(screen.getByRole("heading", { name: "WhatsApp" })).toBeInTheDocument();
    expect(screen.getByText("Whatsapp Web API")).toBeInTheDocument();
    expect(screen.queryByText("Meta Cloud API")).not.toBeInTheDocument();
    expect(screen.queryByText(/um canal fica ativo por vez/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Escolha o canal")).not.toBeInTheDocument();
    expect(screen.queryByText("Autorize a conexão")).not.toBeInTheDocument();
    expect(screen.queryByText("Aguarde a confirmação")).not.toBeInTheDocument();
    expect(screen.queryByText(/O QR Web exige VPS/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Conecte seu WhatsApp Business/i)).toBeInTheDocument();
    expect(screen.getAllByText("Confirmação de agendamento para o cliente")).not.toHaveLength(0);
    expect(screen.getAllByText(localizeWhatsAppCopy("Confirmação de agendamento para o profissional", "los-barberos"))).not.toHaveLength(0);
    expect(screen.getAllByText("Confirmação de presença às 8h")).not.toHaveLength(0);
    expect(screen.getAllByText("Confirmação de presença 3 horas antes")).not.toHaveLength(0);
    expect(screen.getAllByText("Confirmação de presença 45 minutos antes")).not.toHaveLength(0);
    expect(screen.getAllByText("Confirmação de presença 24 horas antes")).not.toHaveLength(0);
    fireEvent.click(screen.getByText("Agendamentos e lembretes"));
    fireEvent.click(screen.getByRole("button", { name: "Expandir mensagem: Confirmação de agendamento para o cliente" }));
    expect(screen.getByRole("button", { name: "Editar texto: Confirmação de agendamento para o cliente" })).toBeInTheDocument();
    expect(screen.getByText("Mensagens Personalizadas")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Mensagens após o serviço"));
    expect(screen.getByLabelText("Texto de 14 dias após o serviço")).toBeInTheDocument();
    expect(screen.queryByText("Confirmação do agendamento")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Mensagem de boas-vindas")).not.toBeInTheDocument();
  });

  it("abre e recolhe o editor de cada mensagem sem fechar o grupo", () => {
    render(<WhatsAppSettings organizationId="org-1" organizationName="Barbearia Central" status={status} />);

    const title = "Confirmação de agendamento para o cliente";
    const messageGroup = screen.getByText("Agendamentos e lembretes").closest("details");
    expect(messageGroup).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("Agendamentos e lembretes"));

    const expandButton = screen.getByRole("button", { name: `Expandir mensagem: ${title}` });
    expect(expandButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("textbox", { name: `Texto: ${title}` })).not.toBeInTheDocument();

    fireEvent.click(expandButton);
    expect(screen.getByLabelText(`Texto: ${title}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: `Recolher mensagem: ${title}` }));
    expect(screen.queryByRole("textbox", { name: `Texto: ${title}` })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Expandir mensagem: ${title}` })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("textbox", { name: "Texto: Confirmação de agendamento para o profissional" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: `Expandir mensagem: ${title}` }));
    expect(screen.getByLabelText(`Texto: ${title}`)).toBeInTheDocument();
  }, 15000);

  it.each(["los-barberos", "le-gras", "pro-stetic", "music-pro"] as const)("inicia todos os menus do WhatsApp recolhidos em %s", (productKey) => {
    const { container } = render(<WhatsAppSettings organizationId="org-1" organizationName="Estabelecimento" status={status} productKey={productKey} />);
    const productCopy = getWhatsAppProductCopy(productKey);

    const groups = [...container.querySelectorAll("details")];
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.every((group) => !group.open)).toBe(true);

    const messageToggles = [...container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Expandir mensagem:"]')];
    expect(messageToggles.length).toBeGreaterThan(0);
    expect(messageToggles.every((button) => button.getAttribute("aria-expanded") === "false")).toBe(true);

    expect(screen.getByRole("heading", { name: productCopy.heroTitle })).toBeInTheDocument();
    const settingsRoot = container.querySelector(".settings-page");
    if (productCopy.rootClass) expect(settingsRoot?.className).toContain(productCopy.rootClass);
    fireEvent.click(screen.getByText("Respostas e retornos"));
    const confirmationTitle = localizeWhatsAppCopy("Cliente confirmou presença", productKey);
    fireEvent.click(screen.getByRole("button", { name: `Expandir mensagem: ${confirmationTitle}` }));
    expect(screen.getByRole("button", { name: `Inserir {profissional} em ${confirmationTitle}` })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `Inserir {barbeiro} em ${confirmationTitle}` })).not.toBeInTheDocument();
  });

  it.each(["los-barberos", "le-gras", "pro-stetic", "music-pro"] as const)("protege as opções numéricas das confirmações em %s", async (productKey) => {
    const fixedPrompt = "Responda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente";
    const confirmationTemplates = {
      REMINDER_T24_CLIENT: "Cabeçalho T24\n\nResponda somente com um número:\n1 — Opção alterada",
      INVALID_REPLY_PROMPT: "Cabeçalho inválida\n\nResponda somente com um número:\n1 — Opção alterada",
    };
    render(<WhatsAppSettings organizationId="org-1" organizationName="Estabelecimento" productKey={productKey} status={{
      ...status,
      automation: { ...status.automation, message_templates: confirmationTemplates },
    }} />);

    fireEvent.click(screen.getByText(getWhatsAppProductCopy(productKey).bookingGroupTitle));
    fireEvent.click(screen.getByRole("button", { name: "Expandir mensagem: Confirmação de presença 24 horas antes" }));
    const reminderEditor = screen.getByRole("textbox", { name: "Cabeçalho editável: Confirmação de presença 24 horas antes" });
    expect(reminderEditor).toHaveValue("Cabeçalho T24");
    expect(reminderEditor.closest("article")?.querySelector("aside pre")).toHaveTextContent(/Responda somente com um número: 1 — Confirmar 2 — Cancelar 3 — Falar com atendente/);
    expect(reminderEditor.closest("article")).toHaveTextContent(/As opções 1, 2 e 3 controlam o fluxo de confirmação/);

    fireEvent.click(screen.getByRole("button", { name: "Editar texto: Confirmação de presença 24 horas antes" }));
    fireEvent.change(reminderEditor, { target: { value: `Novo cabeçalho\n\n${fixedPrompt.replace("1 — Confirmar", "1 — Alterado")}` } });
    expect(reminderEditor).toHaveValue("Novo cabeçalho");
    fireEvent.click(screen.getByRole("button", { name: "Salvar texto: Confirmação de presença 24 horas antes" }));

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("save_whatsapp_v2_automation_controls", expect.objectContaining({
      p_rules: expect.objectContaining({ message_templates: expect.objectContaining({ REMINDER_T24_CLIENT: `Novo cabeçalho\n\n${fixedPrompt}` }) }),
    })));

    fireEvent.click(screen.getByText("Respostas e retornos"));
    fireEvent.click(screen.getByRole("button", { name: "Expandir mensagem: Resposta inválida" }));
    const invalidReplyEditor = screen.getByRole("textbox", { name: "Cabeçalho editável: Resposta inválida" });
    expect(invalidReplyEditor).toHaveValue("Cabeçalho inválida");
    expect(screen.getAllByText(/Responda somente com um número/).length).toBeGreaterThan(0);
  });

  it("edita uma mensagem, insere variável no cursor e salva o template", async () => {
    render(<WhatsAppSettings organizationId="org-1" organizationName="Barbearia Central" status={status} />);

    fireEvent.click(screen.getByText("Agendamentos e lembretes"));
    fireEvent.click(screen.getByRole("button", { name: "Expandir mensagem: Confirmação de agendamento para o cliente" }));
    fireEvent.click(screen.getByRole("button", { name: "Editar texto: Confirmação de agendamento para o cliente" }));
    const editor = screen.getByLabelText("Texto: Confirmação de agendamento para o cliente");
    fireEvent.change(editor, { target: { value: "Oi !", selectionStart: 3, selectionEnd: 3 } });
    fireEvent.click(screen.getByRole("button", { name: "Inserir {cliente} em Confirmação de agendamento para o cliente" }));
    expect(editor).toHaveValue("Oi {cliente}!");
    fireEvent.click(screen.getByRole("button", { name: "Salvar texto: Confirmação de agendamento para o cliente" }));

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("save_whatsapp_v2_automation_controls", expect.objectContaining({
      p_rules: expect.objectContaining({ message_templates: expect.objectContaining({ BOOKING_CREATED_CLIENT: "Oi {cliente}!" }) }),
    })));
  });

  it("não salva uma mensagem vazia", () => {
    render(<WhatsAppSettings organizationId="org-1" organizationName="Barbearia Central" status={status} />);

    fireEvent.click(screen.getByText("Agendamentos e lembretes"));
    fireEvent.click(screen.getByRole("button", { name: "Expandir mensagem: Confirmação de agendamento para o cliente" }));
    fireEvent.click(screen.getByRole("button", { name: "Editar texto: Confirmação de agendamento para o cliente" }));
    fireEvent.change(screen.getByLabelText("Texto: Confirmação de agendamento para o cliente"), { target: { value: "   " } });

    expect(screen.getByRole("button", { name: "Salvar texto: Confirmação de agendamento para o cliente" })).toBeDisabled();
  });

  it("desativa os outros lembretes ao ativar um horário", () => {
    render(<WhatsAppSettings organizationId="org-1" organizationName="Barbearia Central" status={status} />);
    fireEvent.click(screen.getByText("Agendamentos e lembretes"));
    const morning = screen.getByRole("checkbox", { name: "Ativar Confirmação de presença às 8h" });
    const t45 = screen.getByRole("checkbox", { name: "Ativar Confirmação de presença 45 minutos antes" });
    const t24 = screen.getByRole("checkbox", { name: "Ativar Confirmação de presença 24 horas antes" });

    fireEvent.click(t24);
    expect(t24).toBeChecked();
    expect(morning).not.toBeChecked();
    expect(t45).not.toBeChecked();
  });

  it("não expõe campos de token ou segredo", () => {
    render(<WhatsAppSettings organizationId="org-1" organizationName="Barbearia Central" status={status} />);

    expect(screen.queryByLabelText(/token|secret|senha/i)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Variáveis e personalização serão liberadas/i)).not.toHaveLength(0);
  });

  it("mantém mensagens personalizadas bloqueadas até a função ser liberada", () => {
    render(<WhatsAppSettings organizationId="org-1" organizationName="Barbearia Central" status={status} />);

    expect(screen.getByText("FUNÇÃO EM BREVE")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Ativar Aniversário" })).toBeDisabled();
    expect(screen.getByLabelText("Texto de Aniversário")).toBeDisabled();
    fireEvent.click(screen.getByText("Mensagens de Felicitações"));
    expect(screen.getByRole("button", { name: "Salvar automações" })).toBeDisabled();
    expect(rpcMock).not.toHaveBeenCalledWith("save_whatsapp_v2_automation_controls", expect.anything());
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
