import { describe, expect, it } from "vitest";

import {
  phoneFromWhatsappJid,
  senderPhoneFromMessageKey,
} from "../../supabase/functions/_shared/evolution-message";

describe("identidade de mensagens Evolution", () => {
  it("usa remoteJidAlt quando o identificador principal e LID", () => {
    expect(senderPhoneFromMessageKey({
      remoteJid: "123456789012345@lid",
      remoteJidAlt: "5511999999999@s.whatsapp.net",
    })).toBe("+5511999999999");
  });

  it("aceita JID telefonico direto", () => {
    expect(senderPhoneFromMessageKey({
      remoteJid: "5511988888888@s.whatsapp.net",
    })).toBe("+5511988888888");
  });

  it("nunca converte LID em telefone", () => {
    expect(phoneFromWhatsappJid("123456789012345@lid")).toBeNull();
    expect(senderPhoneFromMessageKey({ remoteJid: "123456789012345@lid" })).toBeNull();
  });

  it("ignora conversas de grupo mesmo com participante", () => {
    expect(senderPhoneFromMessageKey({
      remoteJid: "120363000000000000@g.us",
      participant: "5511977777777@s.whatsapp.net",
    })).toBeNull();
  });

  it("remove sufixo de dispositivo de JID telefonico", () => {
    expect(phoneFromWhatsappJid("5511966666666:12@s.whatsapp.net")).toBe("+5511966666666");
  });
});
