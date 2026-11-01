import { describe, expect, it } from "vitest";
import {
  getWhatsAppProductCopy,
  getWhatsAppProductDefaultTemplates,
  localizeWhatsAppCopy,
  resolveWhatsAppProductTemplates,
} from "@/components/connected-manager/whatsapp-product-copy";

describe("WhatsApp product copy", () => {
  it.each([
    ["los-barberos", "WhatsApp da sua barbearia", "barbeiro", ""],
    ["le-gras", "WhatsApp do seu estúdio", "profissional de fotografia", "leGrasWhatsApp"],
    ["pro-stetic", "WhatsApp do seu estúdio", "profissional", "proSteticWhatsApp"],
    ["music-pro", "WhatsApp da sua escola", "professor(a) ou músico(a)", "musicProWhatsApp"],
  ] as const)("fornece aparência e vocabulário para %s", (productKey, heading, professional, rootClass) => {
    const copy = getWhatsAppProductCopy(productKey);

    expect(copy.heroTitle).toBe(heading);
    expect(copy.terms.professional).toBe(professional);
    expect(copy.heroClass).toBeDefined();
    expect(copy.rootClass).toBe(rootClass);
  });

  it("gera mensagens iniciais adequadas ao produto e usa a variável canônica", () => {
    expect(getWhatsAppProductDefaultTemplates("le-gras").ATTENDANT_REQUEST_MANAGER)
      .toContain("Profissional: {profissional}");
    expect(getWhatsAppProductDefaultTemplates("music-pro").REMINDER_T24_CLIENT)
      .toContain("sua aula");
    expect(getWhatsAppProductDefaultTemplates("pro-stetic").CANCELLATION_ACK_CLIENT)
      .toContain("estúdio");
    expect(getWhatsAppProductDefaultTemplates("los-barberos").ATTENDANT_REQUEST_MANAGER)
      .toContain("Barbeiro: {profissional}");
    expect(getWhatsAppProductDefaultTemplates("le-gras").CONFIRMATION_ACK_CLIENT)
      .toContain("na sessão");
    expect(getWhatsAppProductDefaultTemplates("pro-stetic").BOOKING_CREATED_CLIENT)
      .toContain("atendimento no estúdio");
  });

  it.each([
    ["los-barberos", "no atendimento", "cancelou o atendimento", "manualmente o atendimento"],
    ["le-gras", "na sessão", "cancelou a sessão", "manualmente a sessão"],
    ["pro-stetic", "no atendimento", "cancelou o atendimento", "manualmente o atendimento"],
    ["music-pro", "na aula", "cancelou a aula", "manualmente a aula"],
  ] as const)("usa termos naturais nos modelos de auxiliares de %s", (productKey, bookingPhrase, cancellationPhrase, manualPhrase) => {
    const templates = getWhatsAppProductDefaultTemplates(productKey);

    expect(templates.BOOKING_CREATED_AUXILIARY).toContain(bookingPhrase);
    expect(templates.APPOINTMENT_CONFIRMED_AUXILIARY).toContain(bookingPhrase);
    expect(templates.APPOINTMENT_CANCELED_AUXILIARY).toContain(cancellationPhrase);
    expect(templates.MANUAL_CONFIRMATION_AUXILIARY).toContain(manualPhrase);
  });

  it("localiza apenas defaults antigos e preserva templates personalizados", () => {
    const resolved = resolveWhatsAppProductTemplates("music-pro", {
      BOOKING_CREATED_CLIENT: "{cliente}, seu agendamento foi confirmado para {horario}.",
      BOOKING_CREATED_STAFF: "Texto personalizado do gestor.",
    });

    expect(resolved.BOOKING_CREATED_CLIENT).toContain("aula");
    expect(resolved.BOOKING_CREATED_STAFF).toBe("Texto personalizado do gestor.");
  });

  it("localiza também o default neutro atual quando o RPC ainda não tem configuração", () => {
    const resolved = resolveWhatsAppProductTemplates("pro-stetic", {
      BOOKING_CREATED_CLIENT: "{cliente}, seu agendamento foi confirmado para {horario}.",
      ATTENDANT_REQUEST_MANAGER: "Cliente deseja falar com atendente.\n\nCliente: {cliente}\nWhatsApp: {telefone}\nData e hora: {horario}\nProfissional: {profissional}\nServiço: {servico}",
    });

    expect(resolved.BOOKING_CREATED_CLIENT).toContain("atendimento no estúdio");
    expect(resolved.ATTENDANT_REQUEST_MANAGER).toContain("Profissional: {profissional}");
  });

  it("mantém a concordância dos textos ao adaptar o vocabulário do lembrete", () => {
    expect(localizeWhatsAppCopy("Enviada ao cliente antes do atendimento.", "le-gras"))
      .toBe("Enviada ao cliente antes da sessão.");
    expect(localizeWhatsAppCopy("Enviada ao cliente antes do atendimento.", "music-pro"))
      .toBe("Enviada ao estudante antes da aula.");
    expect(localizeWhatsAppCopy("Enviada ao cliente antes do atendimento.", "pro-stetic"))
      .toBe("Enviada ao cliente antes do atendimento.");
  });
});
