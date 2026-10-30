import type { ProductKey } from "@/lib/product-context";

export type WhatsAppFixedMessageKey =
  | "BOOKING_CREATED_CLIENT" | "BOOKING_CREATED_STAFF"
  | "REMINDER_T24_CLIENT" | "REMINDER_MORNING_CLIENT" | "REMINDER_T180_CLIENT" | "REMINDER_T45_CLIENT"
  | "CONFIRMATION_ACK_CLIENT" | "CANCELLATION_ACK_CLIENT"
  | "APPOINTMENT_CONFIRMED_STAFF" | "APPOINTMENT_CANCELED_STAFF"
  | "INVALID_REPLY_PROMPT" | "ATTENDANT_REQUEST_MANAGER"
  | "MANUAL_CONFIRMATION_CLIENT" | "MANUAL_CONFIRMATION_STAFF" | "RESERVATION_CHOICE"
  | "PROJECT_CONTRACT_CREATED_CLIENT" | "SUBSCRIPTION_CREATED_CLIENT";

type ProductTerms = {
  customer: string;
  customerPlural: string;
  professional: string;
  professionalPlural: string;
  booking: string;
  bookingPlural: string;
  attendance: string;
  attendancePlural: string;
  service: string;
  servicePlural: string;
  organization: string;
  organizationWithArticle: string;
  reminderSubject: string;
};

export type WhatsAppProductCopy = {
  heroEyebrow: string;
  heroTitle: string;
  heroDescription: string;
  rootClass: string;
  heroClass: string;
  terms: ProductTerms;
  bookingGroupTitle: string;
  bookingGroupDescription: string;
  responseGroupDescription: string;
  managerNotificationDescription: string;
  customAfterServiceTitle: string;
};

const CONFIRMATION_REPLY = "Responda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente";
const legacySharedDefaults: Record<WhatsAppFixedMessageKey, string> = {
  BOOKING_CREATED_CLIENT: "{cliente}, seu agendamento foi confirmado para {horario}.",
  BOOKING_CREATED_STAFF: "Novo agendamento: {cliente}, {horario}.",
  REMINDER_T24_CLIENT: `Lembrete: seu atendimento está marcado para {horario} (daqui a 24 horas).\n\n${CONFIRMATION_REPLY}`,
  REMINDER_MORNING_CLIENT: `Lembrete: seu atendimento é {horario}.\n\n${CONFIRMATION_REPLY}`,
  REMINDER_T180_CLIENT: `Lembrete: seu atendimento está marcado para {horario}.\n\n${CONFIRMATION_REPLY}`,
  REMINDER_T45_CLIENT: `Lembrete: seu atendimento está marcado para {horario}.\n\n${CONFIRMATION_REPLY}`,
  CONFIRMATION_ACK_CLIENT: "Presença confirmada. Até {horario}.",
  CANCELLATION_ACK_CLIENT: "Cancelamento confirmado. Se precisar, fale com o estabelecimento para novo horário.",
  APPOINTMENT_CONFIRMED_STAFF: "{cliente} confirmou presença pelo WhatsApp para {horario}.",
  APPOINTMENT_CANCELED_STAFF: "{cliente} cancelou pelo WhatsApp.",
  INVALID_REPLY_PROMPT: `Não entendi sua resposta.\n\n${CONFIRMATION_REPLY}`,
  ATTENDANT_REQUEST_MANAGER: `Cliente deseja falar com atendente.\n\nCliente: {cliente}\nWhatsApp: {telefone}\nData e hora: {horario}\nProfissional: {barbeiro}\nServiço: {servico}`,
  MANUAL_CONFIRMATION_CLIENT: "{cliente}, seu agendamento foi confirmado pelo estabelecimento para {horario}.",
  MANUAL_CONFIRMATION_STAFF: "Agendamento confirmado manualmente: {cliente}, {horario}.",
  RESERVATION_CHOICE: `Encontrei mais de um agendamento. Responda com o número correspondente:\n\n{reservas}`,
  PROJECT_CONTRACT_CREATED_CLIENT: "Olá! {cliente}, passando para informar que foi criado um novo plano de serviços para você. Para mais detalhes e aceite do plano, acesse o app do cliente na aba Assinaturas: {link_app_cliente}. Você deve fazer login no app com o e-mail {email_cliente}.",
  SUBSCRIPTION_CREATED_CLIENT: "Olá! {cliente}, passando para informar que foi criada uma nova assinatura para você. Para mais detalhes e aceite desta assinatura, acesse o app do cliente na aba Assinaturas: {link_app_cliente}. Você deve fazer login no app com o e-mail {email_cliente}.",
};
const canonicalSharedDefaults: Record<WhatsAppFixedMessageKey, string> = {
  ...legacySharedDefaults,
  CANCELLATION_ACK_CLIENT: "Cancelamento confirmado. Se precisar, fale com o estabelecimento para novo horário.",
  ATTENDANT_REQUEST_MANAGER: `Cliente deseja falar com atendente.\n\nCliente: {cliente}\nWhatsApp: {telefone}\nData e hora: {horario}\nProfissional: {profissional}\nServiço: {servico}`,
};

const productCopy: Record<ProductKey, WhatsAppProductCopy> = {
  "los-barberos": {
    heroEyebrow: "INTEGRAÇÃO POR BARBEARIA",
    heroTitle: "WhatsApp da sua barbearia",
    heroDescription: "Conecte seu WhatsApp Business e envie confirmações e lembretes de atendimentos com consentimento dos clientes.",
    rootClass: "",
    heroClass: "",
    terms: { customer: "cliente", customerPlural: "clientes", professional: "barbeiro", professionalPlural: "barbeiros", booking: "agendamento", bookingPlural: "agendamentos", attendance: "atendimento", attendancePlural: "atendimentos", service: "serviço", servicePlural: "serviços", organization: "barbearia", organizationWithArticle: "a barbearia", reminderSubject: "seu atendimento" },
    bookingGroupTitle: "Agendamentos e lembretes",
    bookingGroupDescription: "Ative confirmações e escolha um único horário de lembrete.",
    responseGroupDescription: "Textos enviados depois que o cliente responde ou o gestor confirma.",
    managerNotificationDescription: "Receba pedidos de contato dos clientes em um WhatsApp separado da conta conectada ao QR.",
    customAfterServiceTitle: "Mensagens após o serviço",
  },
  "le-gras": {
    heroEyebrow: "INTEGRAÇÃO WHATSAPP",
    heroTitle: "WhatsApp do seu estúdio",
    heroDescription: "Conecte o WhatsApp Business do estúdio e envie confirmações e lembretes de sessões fotográficas aos clientes.",
    rootClass: "leGrasWhatsApp",
    heroClass: "whatsappHeroLeGras",
    terms: { customer: "cliente", customerPlural: "clientes", professional: "profissional de fotografia", professionalPlural: "profissionais de fotografia", booking: "sessão fotográfica", bookingPlural: "sessões fotográficas", attendance: "sessão", attendancePlural: "sessões", service: "sessão fotográfica", servicePlural: "sessões fotográficas", organization: "estúdio", organizationWithArticle: "o estúdio", reminderSubject: "sua sessão fotográfica" },
    bookingGroupTitle: "Agendamentos e sessões",
    bookingGroupDescription: "Ative confirmações e escolha um único horário de lembrete.",
    responseGroupDescription: "Textos enviados depois que o cliente responde ou o gestor confirma.",
    managerNotificationDescription: "Receba pedidos de contato dos clientes em um WhatsApp separado da conta conectada ao QR.",
    customAfterServiceTitle: "Mensagens após a sessão",
  },
  "pro-stetic": {
    heroEyebrow: "INTEGRAÇÃO WHATSAPP",
    heroTitle: "WhatsApp do seu estúdio",
    heroDescription: "Conecte o WhatsApp Business do estúdio e envie confirmações e lembretes de serviços de estética e beleza com consentimento dos clientes.",
    rootClass: "proSteticWhatsApp",
    heroClass: "whatsappHeroProStetic",
    terms: { customer: "cliente", customerPlural: "clientes", professional: "profissional", professionalPlural: "profissionais", booking: "serviço", bookingPlural: "serviços", attendance: "atendimento", attendancePlural: "atendimentos", service: "serviço", servicePlural: "serviços", organization: "estúdio", organizationWithArticle: "o estúdio", reminderSubject: "seu atendimento" },
    bookingGroupTitle: "Atendimentos e lembretes",
    bookingGroupDescription: "Ative confirmações e escolha um único horário de lembrete.",
    responseGroupDescription: "Textos enviados depois que o cliente responde ou o gestor confirma.",
    managerNotificationDescription: "Receba pedidos de contato dos clientes em um WhatsApp separado da conta conectada ao QR.",
    customAfterServiceTitle: "Mensagens após o serviço",
  },
  "music-pro": {
    heroEyebrow: "INTEGRAÇÃO WHATSAPP",
    heroTitle: "WhatsApp da sua escola",
    heroDescription: "Conecte seu WhatsApp Business e envie confirmações e lembretes de aulas com consentimento dos estudantes.",
    rootClass: "musicProWhatsApp",
    heroClass: "whatsappHeroMusicPro",
    terms: { customer: "estudante", customerPlural: "estudantes", professional: "professor(a) ou músico(a)", professionalPlural: "professores(as) e músicos(as)", booking: "aula", bookingPlural: "aulas", attendance: "aula", attendancePlural: "aulas", service: "aula", servicePlural: "aulas", organization: "escola", organizationWithArticle: "a escola", reminderSubject: "sua aula" },
    bookingGroupTitle: "Aulas e lembretes",
    bookingGroupDescription: "Ative confirmações e escolha um único horário de lembrete.",
    responseGroupDescription: "Textos enviados depois que o estudante responde ou a gestão confirma.",
    managerNotificationDescription: "Receba pedidos de contato dos estudantes em um WhatsApp separado da conta conectada ao QR.",
    customAfterServiceTitle: "Mensagens após a aula",
  },
};

const reminderTemplates = (subject: string, when: string) =>
  `Lembrete: ${subject} ${when}.\n\n${CONFIRMATION_REPLY}`;

export function getWhatsAppProductCopy(productKey: ProductKey): WhatsAppProductCopy {
  return productCopy[productKey];
}

export function getWhatsAppProductDefaultTemplates(productKey: ProductKey): Record<WhatsAppFixedMessageKey, string> {
  const { terms } = productCopy[productKey];
  const reminder = (when: string) => reminderTemplates(terms.reminderSubject, when);
  const shared: Record<WhatsAppFixedMessageKey, string> = {
    BOOKING_CREATED_CLIENT: "{cliente}, seu agendamento foi confirmado para {horario}.",
    BOOKING_CREATED_STAFF: "Novo agendamento: {cliente}, {horario}.",
    REMINDER_T24_CLIENT: reminder("está marcado para {horario} (daqui a 24 horas)"),
    REMINDER_MORNING_CLIENT: reminder("é {horario}"),
    REMINDER_T180_CLIENT: reminder("está marcado para {horario}"),
    REMINDER_T45_CLIENT: reminder("está marcado para {horario}"),
    CONFIRMATION_ACK_CLIENT: "Presença confirmada. Até {horario}.",
    CANCELLATION_ACK_CLIENT: "Cancelamento confirmado. Se precisar, fale com o estabelecimento para marcar novo horário.",
    APPOINTMENT_CONFIRMED_STAFF: "{cliente} confirmou presença pelo WhatsApp para {horario}.",
    APPOINTMENT_CANCELED_STAFF: "{cliente} cancelou pelo WhatsApp.",
    INVALID_REPLY_PROMPT: `Não entendi sua resposta.\n\n${CONFIRMATION_REPLY}`,
    ATTENDANT_REQUEST_MANAGER: `${terms.customer[0].toUpperCase()}${terms.customer.slice(1)} deseja falar com atendente.\n\n${terms.customer[0].toUpperCase()}${terms.customer.slice(1)}: {cliente}\nWhatsApp: {telefone}\nData e hora: {horario}\n${terms.professional[0].toUpperCase()}${terms.professional.slice(1)}: {profissional}\n${terms.service[0].toUpperCase()}${terms.service.slice(1)}: {servico}`,
    MANUAL_CONFIRMATION_CLIENT: "{cliente}, seu agendamento foi confirmado pelo estabelecimento para {horario}.",
    MANUAL_CONFIRMATION_STAFF: "Agendamento confirmado manualmente: {cliente}, {horario}.",
    RESERVATION_CHOICE: "Encontrei mais de um agendamento. Responda com o número correspondente:\n\n{reservas}",
    PROJECT_CONTRACT_CREATED_CLIENT: "Olá! {cliente}, passando para informar que foi criado um novo plano de serviços para você. Para mais detalhes e aceite do plano, acesse o app do cliente na aba Assinaturas: {link_app_cliente}. Você deve fazer login no app com o e-mail {email_cliente}.",
    SUBSCRIPTION_CREATED_CLIENT: "Olá! {cliente}, passando para informar que foi criada uma nova assinatura para você. Para mais detalhes e aceite desta assinatura, acesse o app do cliente na aba Assinaturas: {link_app_cliente}. Você deve fazer login no app com o e-mail {email_cliente}.",
  };

  switch (productKey) {
    case "los-barberos":
      return {
        ...shared,
        BOOKING_CREATED_CLIENT: "{cliente}, seu agendamento na barbearia foi confirmado para {horario}.",
        BOOKING_CREATED_STAFF: "Novo agendamento na barbearia: {cliente}, {horario}.",
        CANCELLATION_ACK_CLIENT: "Cancelamento confirmado. Se precisar, fale com a barbearia para marcar novo horário.",
        ATTENDANT_REQUEST_MANAGER: "Cliente deseja falar com atendente.\n\nCliente: {cliente}\nWhatsApp: {telefone}\nData e hora: {horario}\nBarbeiro: {profissional}\nServiço: {servico}",
        MANUAL_CONFIRMATION_CLIENT: "{cliente}, seu agendamento foi confirmado pela barbearia para {horario}.",
      };
    case "le-gras":
      return {
        ...shared,
        BOOKING_CREATED_CLIENT: "{cliente}, sua sessão fotográfica no estúdio foi confirmada para {horario}.",
        BOOKING_CREATED_STAFF: "Nova sessão fotográfica: {cliente}, {horario}.",
        CONFIRMATION_ACK_CLIENT: "Presença na sessão confirmada. Até {horario}.",
        CANCELLATION_ACK_CLIENT: "Cancelamento confirmado. Se precisar, fale com o estúdio para marcar novo horário.",
        APPOINTMENT_CONFIRMED_STAFF: "{cliente} confirmou presença na sessão pelo WhatsApp para {horario}.",
        APPOINTMENT_CANCELED_STAFF: "{cliente} cancelou a sessão pelo WhatsApp.",
        ATTENDANT_REQUEST_MANAGER: "Cliente deseja falar com atendente.\n\nCliente: {cliente}\nWhatsApp: {telefone}\nData e hora: {horario}\nProfissional: {profissional}\nSessão fotográfica: {servico}",
        MANUAL_CONFIRMATION_CLIENT: "{cliente}, sua sessão fotográfica foi confirmada pelo estúdio para {horario}.",
        MANUAL_CONFIRMATION_STAFF: "Sessão fotográfica confirmada manualmente: {cliente}, {horario}.",
        RESERVATION_CHOICE: "Encontrei mais de uma sessão. Responda com o número correspondente:\n\n{reservas}",
      };
    case "pro-stetic":
      return {
        ...shared,
        BOOKING_CREATED_CLIENT: "{cliente}, seu atendimento no estúdio foi confirmado para {horario}.",
        BOOKING_CREATED_STAFF: "Novo atendimento no estúdio: {cliente}, {horario}.",
        CONFIRMATION_ACK_CLIENT: "Presença no atendimento confirmada. Até {horario}.",
        CANCELLATION_ACK_CLIENT: "Cancelamento confirmado. Se precisar, fale com o estúdio para marcar novo horário.",
        APPOINTMENT_CONFIRMED_STAFF: "{cliente} confirmou presença no atendimento pelo WhatsApp para {horario}.",
        APPOINTMENT_CANCELED_STAFF: "{cliente} cancelou o atendimento pelo WhatsApp.",
        ATTENDANT_REQUEST_MANAGER: "Cliente deseja falar com atendente.\n\nCliente: {cliente}\nWhatsApp: {telefone}\nData e hora: {horario}\nProfissional: {profissional}\nServiço: {servico}",
        MANUAL_CONFIRMATION_CLIENT: "{cliente}, seu atendimento foi confirmado pelo estúdio para {horario}.",
        MANUAL_CONFIRMATION_STAFF: "Atendimento confirmado manualmente: {cliente}, {horario}.",
        RESERVATION_CHOICE: "Encontrei mais de um atendimento. Responda com o número correspondente:\n\n{reservas}",
      };
    case "music-pro":
      return {
        ...shared,
        BOOKING_CREATED_CLIENT: "{cliente}, sua aula na escola foi confirmada para {horario}.",
        BOOKING_CREATED_STAFF: "Nova aula na escola: {cliente}, {horario}.",
        CONFIRMATION_ACK_CLIENT: "Presença na aula confirmada. Até {horario}.",
        CANCELLATION_ACK_CLIENT: "Cancelamento confirmado. Se precisar, fale com a escola para marcar novo horário.",
        APPOINTMENT_CONFIRMED_STAFF: "{cliente} confirmou presença na aula pelo WhatsApp para {horario}.",
        APPOINTMENT_CANCELED_STAFF: "{cliente} cancelou a aula pelo WhatsApp.",
        ATTENDANT_REQUEST_MANAGER: "Estudante deseja falar com a equipe.\n\nEstudante: {cliente}\nWhatsApp: {telefone}\nData e hora: {horario}\nProfessor(a) ou músico(a): {profissional}\nAula: {servico}",
        MANUAL_CONFIRMATION_CLIENT: "{cliente}, sua aula foi confirmada pela escola para {horario}.",
        MANUAL_CONFIRMATION_STAFF: "Aula confirmada manualmente: {cliente}, {horario}.",
        RESERVATION_CHOICE: "Encontrei mais de uma aula. Responda com o número correspondente:\n\n{reservas}",
      };
  }
}

function replaceTerm(value: string, source: string, target: string): string {
  const capitalizedTarget = `${target[0]?.toUpperCase() ?? ""}${target.slice(1)}`;
  const capitalizedSource = `${source[0]?.toUpperCase() ?? ""}${source.slice(1)}`;
  return value.replaceAll(capitalizedSource, capitalizedTarget).replaceAll(source, target);
}

export function localizeWhatsAppCopy(value: string, productKey: ProductKey): string {
  const { terms } = productCopy[productKey];
  let localized = value;
  const productPhrases: Partial<Record<ProductKey, Array<[string, string]>>> = {
    "le-gras": [["antes do atendimento", "antes da sessão"], ["no dia do atendimento", "no dia da sessão"], ["um novo agendamento", "uma nova sessão"], ["Novo agendamento", "Nova sessão"], ["novo agendamento", "nova sessão"]],
    "music-pro": [["antes do atendimento", "antes da aula"], ["no dia do atendimento", "no dia da aula"], ["um novo agendamento", "uma nova aula"], ["Novo agendamento", "Nova aula"], ["novo agendamento", "nova aula"]],
  };
  for (const [source, target] of productPhrases[productKey] ?? []) localized = localized.replaceAll(source, target);
  const replacements: Array<[string, string]> = [
    ["após o serviço", `após ${productKey === "music-pro" ? "a aula" : productKey === "le-gras" ? "a sessão" : productKey === "pro-stetic" ? "o procedimento" : "o serviço"}`],
    ["profissionais", terms.professionalPlural],
    ["clientes", terms.customerPlural],
    ["agendamentos", terms.bookingPlural],
    ["atendimentos", terms.attendancePlural],
    ["serviços", terms.servicePlural],
    ["profissional", terms.professional],
    ["cliente", terms.customer],
    ["agendamento", terms.booking],
    ["atendimento", terms.attendance],
    ["serviço", terms.service],
  ];
  for (const [source, target] of replacements) localized = replaceTerm(localized, source, target);
  return localized;
}

export function resolveWhatsAppProductTemplates(
  productKey: ProductKey,
  savedTemplates: Partial<Record<WhatsAppFixedMessageKey, string>> | undefined,
): Record<WhatsAppFixedMessageKey, string> {
  const defaults = getWhatsAppProductDefaultTemplates(productKey);
  const sharedDefaults = getWhatsAppProductDefaultTemplates("los-barberos");
  const saved = savedTemplates ?? {};

  for (const key of Object.keys(defaults) as WhatsAppFixedMessageKey[]) {
    const value = saved[key];
    if (typeof value === "string" && value !== sharedDefaults[key] && value !== legacySharedDefaults[key] && value !== canonicalSharedDefaults[key]) defaults[key] = value;
  }

  return defaults;
}
