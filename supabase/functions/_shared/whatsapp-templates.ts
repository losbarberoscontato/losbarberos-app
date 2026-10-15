type Job = { job_type: string; payload: Record<string, unknown> };

function formatStart(payload: Record<string, unknown>): string {
  const raw = typeof payload.starts_at === "string" ? payload.starts_at : "";
  const timezone = typeof payload.timezone === "string"
    ? payload.timezone
    : "America/Sao_Paulo";
  if (!raw) return "seu horário agendado";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(raw));
}

function configuredTemplate(job: Job): string | null {
  const templates = job.payload.templates;
  if (!templates || typeof templates !== "object" || Array.isArray(templates)) {
    return null;
  }
  const messageKind = typeof job.payload.message_kind === "string"
    ? job.payload.message_kind
    : null;
  const key = job.job_type === "MANUAL_OUTBOUND_TEXT" && messageKind
    ? messageKind
    : job.job_type;
  const value = (templates as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 &&
      value.length <= 4_096
    ? value
    : null;
}

function applyTemplate(template: string, job: Job, fallback: string): string {
  const name = typeof job.payload.customer_name === "string"
    ? job.payload.customer_name
    : "cliente";
  const barber = typeof job.payload.barber_name === "string"
    ? job.payload.barber_name
    : "profissional";
  const service = typeof job.payload.service_names === "string"
    ? job.payload.service_names
    : "Serviço não informado";
  const phone = typeof job.payload.customer_phone === "string"
    ? job.payload.customer_phone
    : "não informado";
  const reservationPrompt = typeof job.payload.body === "string"
    ? job.payload.body
    : "";
  const reservations = typeof job.payload.reservations === "string"
    ? job.payload.reservations
    : job.payload.message_kind === "RESERVATION_CHOICE"
    ? reservationPrompt.split(/\r?\n/).slice(1).join("\n")
    : "";
  const rendered = template
    // Templates persisted through JSON may contain literal "\\n" sequences.
    // Evolution must receive real line breaks for WhatsApp to format them.
    .replaceAll("\\n", "\n")
    .replaceAll("{cliente}", name)
    .replaceAll("{barbeiro}", barber)
    .replaceAll("{horario}", formatStart(job.payload))
    .replaceAll("{servico}", service)
    .replaceAll("{telefone}", phone)
    .replaceAll("{reservas}", reservations);
  return rendered.trim() || fallback;
}

export function textFor(job: Job): string {
  if (typeof job.payload.body === "string" && job.payload.custom_key) {
    return applyTemplate(job.payload.body, job, job.payload.body);
  }
  const name = typeof job.payload.customer_name === "string"
    ? job.payload.customer_name
    : "cliente";
  const barber = typeof job.payload.barber_name === "string"
    ? job.payload.barber_name
    : "profissional";
  const phone = typeof job.payload.customer_phone === "string"
    ? job.payload.customer_phone
    : "não informado";
  const service = typeof job.payload.service_names === "string"
    ? job.payload.service_names
    : "Serviço não informado";
  const messageKind = typeof job.payload.message_kind === "string"
    ? job.payload.message_kind
    : "";
  const when = formatStart(job.payload);
  let fallback: string;
  switch (job.job_type) {
    case "BOOKING_CREATED_CLIENT":
      fallback = `${name}, seu agendamento foi confirmado para ${when}.`;
      break;
    case "BOOKING_CREATED_STAFF":
      fallback = `Novo agendamento: ${name}, ${when}.`;
      break;
    case "REMINDER_MORNING_CLIENT":
      fallback =
        `Lembrete: seu atendimento é ${when}.\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente`;
      break;
    case "REMINDER_T180_CLIENT":
      fallback =
        `Lembrete: seu atendimento está marcado para ${when}.\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente`;
      break;
    case "REMINDER_T45_CLIENT":
      fallback =
        `Lembrete: seu atendimento está marcado para ${when}.\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente`;
      break;
    case "REMINDER_T24_CLIENT":
      fallback =
        `Lembrete: seu atendimento está marcado para ${when} (daqui a 24 horas).\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente`;
      break;
    case "CONFIRMATION_ACK_CLIENT":
      fallback = `Presença confirmada. Até ${when}.`;
      break;
    case "CANCELLATION_ACK_CLIENT":
      fallback =
        "Cancelamento confirmado. Se precisar, fale com a barbearia para novo horário.";
      break;
    case "APPOINTMENT_CONFIRMED_STAFF":
      fallback = `${name} confirmou presença pelo WhatsApp para ${when}.`;
      break;
    case "APPOINTMENT_CANCELED_STAFF":
      fallback = `${name} cancelou pelo WhatsApp.`;
      break;
    case "MANUAL_OUTBOUND_TEXT":
      if (messageKind === "INVALID_REPLY_PROMPT") {
        fallback =
          "Não entendi sua resposta.\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente";
      } else if (messageKind === "ATTENDANT_REQUEST_MANAGER") {
        fallback =
          `Cliente deseja falar com atendente.\n\nCliente: ${name}\nWhatsApp: ${phone}\nData e hora: ${when}\nBarbeiro: ${barber}\nServiço: ${service}`;
      } else if (messageKind === "MANUAL_CONFIRMATION_CLIENT") {
        fallback =
          `${name}, seu agendamento foi confirmado pela barbearia para ${when}.`;
      } else if (messageKind === "MANUAL_CONFIRMATION_STAFF") {
        fallback = `Agendamento confirmado manualmente: ${name}, ${when}.`;
      } else if (messageKind === "RESERVATION_CHOICE") {
        fallback = typeof job.payload.body === "string"
          ? job.payload.body
          : "Encontrei mais de um agendamento. Responda com o número correspondente:\n\n{reservas}";
      } else fallback = `Atualização do agendamento de ${name} com ${barber}.`;
      break;
    default:
      fallback = `Atualização do agendamento de ${name} com ${barber}.`;
  }
  let template = configuredTemplate(job) ?? fallback;
  if (
    job.payload.message_kind === "RESERVATION_CHOICE" &&
    !configuredTemplate(job)
  ) {
    return applyTemplate(fallback, job, fallback);
  }
  return applyTemplate(template, job, fallback);
}
