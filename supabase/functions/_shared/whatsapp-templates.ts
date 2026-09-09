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
  const value = (templates as Record<string, unknown>)[job.job_type];
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
  const rendered = template
    // Templates persisted through JSON may contain literal "\\n" sequences.
    // Evolution must receive real line breaks for WhatsApp to format them.
    .replaceAll("\\n", "\n")
    .replaceAll("{cliente}", name)
    .replaceAll("{barbeiro}", barber)
    .replaceAll("{horario}", formatStart(job.payload))
    .replaceAll("{servico}", service);
  return rendered.trim() || fallback;
}

export function textFor(job: Job): string {
  if (
    typeof job.payload.body === "string" &&
    (job.payload.custom_key ||
      job.payload.message_kind === "RESERVATION_CHOICE")
  ) return applyTemplate(job.payload.body, job, job.payload.body);
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
        `Lembrete: seu atendimento começa em 3 horas (${when}).\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente`;
      break;
    case "REMINDER_T45_CLIENT":
      fallback =
        `Lembrete: seu atendimento começa em 45 minutos (${when}).\n\nResponda somente com um número:\n1 — Confirmar\n2 — Cancelar\n3 — Falar com atendente`;
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
      } else fallback = `Atualização do agendamento de ${name} com ${barber}.`;
      break;
    default:
      fallback = `Atualização do agendamento de ${name} com ${barber}.`;
  }
  let template = configuredTemplate(job) ?? fallback;
  if (
    job.job_type === "REMINDER_T45_CLIENT" ||
    job.job_type === "REMINDER_T180_CLIENT"
  ) {
    template = template.replace(
      /começa em (45 minutos|3 horas)/g,
      "está marcado para",
    );
  }
  return applyTemplate(template, job, fallback);
}
