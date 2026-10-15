import { describe, expect, it } from "vitest";
import { insertTemplateVariable, selectExclusiveReminder } from "../../src/components/connected-manager/whatsapp-message-editing";

describe("edição de mensagens WhatsApp", () => {
  it("ativa um único lembrete e desativa os demais", () => {
    expect(selectExclusiveReminder({
      reminder_t24_enabled: false,
      reminder_morning_enabled: true,
      reminder_t180_enabled: false,
      reminder_t45_enabled: true,
    }, "reminder_t24_enabled", true)).toEqual({
      reminder_t24_enabled: true,
      reminder_morning_enabled: false,
      reminder_t180_enabled: false,
      reminder_t45_enabled: false,
    });
  });

  it("insere a variável no cursor e mantém o texto ao redor", () => {
    expect(insertTemplateVariable("Olá ! amanhã", 4, 4, "{cliente}")).toEqual({
      value: "Olá {cliente}! amanhã",
      cursor: 13,
    });
  });
});
