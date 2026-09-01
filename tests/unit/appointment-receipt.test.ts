import { describe, expect, it } from "vitest";
import { buildAppointmentReceiptDraft } from "@/components/connected-manager/appointment-receipt";

describe("appointment receipt draft", () => {
  it("pre-fills the customer, service, dates and stable attendance document", () => {
    expect(buildAppointmentReceiptDraft({
      appointmentId: "01234567-89ab-cdef-0123-456789abcdef",
      customerId: "customer-1",
      customerName: "Roberto Carlos",
      serviceDescription: "Barba completa",
      barberName: "Alef Gonçalves",
      amountCents: 6500,
      reservedAt: "2026-08-09T18:00:00.000Z",
      completedAt: "2026-08-11T15:00:00.000Z",
    })).toEqual({
      appointmentId: "01234567-89ab-cdef-0123-456789abcdef",
      customerId: "customer-1",
      customerName: "Roberto Carlos",
      description: "Barba completa · Profissional: Alef Gonçalves",
      amountCents: 6500,
      netPaidCents: 0,
      issueDate: "2026-08-09",
      dueDate: "2026-08-11",
      documentNumber: "ATD-01234567",
    });
  });
});
