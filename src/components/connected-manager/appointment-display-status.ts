import type { AppointmentRecord, AppointmentStatus, AppointmentWhatsAppResponseStatus } from "./types";

export type AppointmentDisplayTone = "info" | "success" | "warning" | "danger" | "neutral";
export type AgendaStatusFilter = AppointmentStatus | AppointmentWhatsAppResponseStatus | "ALL" | "SCHEDULED";

export const agendaStatusFilters: AgendaStatusFilter[] = [
  "ALL", "SCHEDULED", "CONFIRMED_BY_WHATSAPP", "RESCHEDULE_REQUESTED_BY_WHATSAPP", "CANCELED_BY_WHATSAPP",
  "HELD", "PENDING_PAYMENT", "IN_SERVICE", "COMPLETED", "NO_SHOW", "EXPIRED",
];

export const agendaStatusFilterLabels: Record<AgendaStatusFilter, string> = {
  ALL: "Todos os status",
  SCHEDULED: "Agendado",
  PENDING: "Agendado",
  CONFIRMED_BY_WHATSAPP: "Confirmado pelo WhatsApp",
  RESCHEDULE_REQUESTED_BY_WHATSAPP: "Solicitado Reagendamento – WhatsApp Gestor",
  CANCELED_BY_WHATSAPP: "Cancelado pelo WhatsApp",
  HELD: "Aguardando pagamento",
  PENDING_PAYMENT: "Pendente de pagamento",
  CONFIRMED: "Agendado",
  IN_SERVICE: "Em serviço",
  COMPLETED: "Concluído",
  CANCELED: "Cancelado",
  NO_SHOW: "Não compareceu",
  EXPIRED: "Expirado",
};

const coreStatusLabels: Record<AppointmentStatus, string> = {
  HELD: "Aguardando pagamento",
  PENDING_PAYMENT: "Pendente de pagamento",
  CONFIRMED: "Agendado",
  IN_SERVICE: "Em serviço",
  COMPLETED: "Concluído",
  CANCELED: "Cancelado",
  NO_SHOW: "Não compareceu",
  EXPIRED: "Expirado",
};

export function appointmentDisplayStatus(appointment: Pick<AppointmentRecord, "status" | "whatsapp_response_status">) {
  if (appointment.status === "CANCELED") {
    return appointment.whatsapp_response_status === "CANCELED_BY_WHATSAPP"
      ? { label: "Cancelado pelo WhatsApp", tone: "danger" as const }
      : { label: "Cancelado", tone: "danger" as const };
  }
  if (appointment.status === "CONFIRMED") {
    if (appointment.whatsapp_response_status === "CONFIRMED_BY_WHATSAPP") return { label: "Confirmado pelo WhatsApp", tone: "success" as const };
    if (appointment.whatsapp_response_status === "RESCHEDULE_REQUESTED_BY_WHATSAPP") return { label: "Solicitado Reagendamento – WhatsApp Gestor", tone: "warning" as const };
    return { label: "Agendado", tone: "info" as const };
  }
  return { label: coreStatusLabels[appointment.status], tone: "neutral" as const };
}

export function matchesAgendaStatusFilter(appointment: AppointmentRecord, filter: AgendaStatusFilter) {
  if (filter === "ALL") return true;
  if (filter === "SCHEDULED") return appointment.status === "CONFIRMED" && (!appointment.whatsapp_response_status || appointment.whatsapp_response_status === "PENDING");
  if (filter === "CONFIRMED_BY_WHATSAPP" || filter === "RESCHEDULE_REQUESTED_BY_WHATSAPP") return appointment.status === "CONFIRMED" && appointment.whatsapp_response_status === filter;
  if (filter === "CANCELED_BY_WHATSAPP") return appointment.status === "CANCELED" && appointment.whatsapp_response_status === filter;
  return appointment.status === filter;
}
