export interface AppointmentReceiptDraft {
  appointmentId: string;
  customerId: string;
  customerName: string;
  description: string;
  amountCents: number;
  issueDate: string;
  dueDate: string;
  documentNumber: string;
}

function dateInSaoPaulo(value: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(value));
}

export function buildAppointmentReceiptDraft(input: {
  appointmentId: string;
  customerId: string;
  customerName: string;
  serviceDescription: string;
  barberName: string;
  amountCents: number;
  reservedAt: string;
  completedAt: string;
}): AppointmentReceiptDraft {
  return {
    appointmentId: input.appointmentId,
    customerId: input.customerId,
    customerName: input.customerName,
    description: `${input.serviceDescription} · Profissional: ${input.barberName}`,
    amountCents: input.amountCents,
    issueDate: dateInSaoPaulo(input.reservedAt),
    dueDate: dateInSaoPaulo(input.completedAt),
    documentNumber: `ATD-${input.appointmentId.slice(0, 8).toUpperCase()}`,
  };
}
