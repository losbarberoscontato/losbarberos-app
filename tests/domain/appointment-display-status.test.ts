import { describe, expect, it } from "vitest";
import { appointmentDisplayStatus, matchesAgendaStatusFilter } from "@/components/connected-manager/appointment-display-status";

const appointment = { status: "CONFIRMED" as const, whatsapp_response_status: "PENDING" as const };

describe("status de agenda derivado da resposta WhatsApp", () => {
  it("mostra agendado para uma nova reserva", () => {
    expect(appointmentDisplayStatus(appointment)).toEqual({ label: "Agendado", tone: "info" });
    expect(matchesAgendaStatusFilter({ ...appointment, id: "a", organization_id: "o", customer_id: "c", barber_id: "b", source: "CUSTOMER", service_period: "[2026-08-17 12:00:00+00,2026-08-17 12:30:00+00)", payment_mode: "COUNTER", currency: "BRL", total_cents_snapshot: 0, notes: null, schedule_override_reason: null, created_at: "2026-08-17T00:00:00.000Z" }, "SCHEDULED")).toBe(true);
  });

  it("representa confirmação, cancelamento, contato e confirmação manual", () => {
    expect(appointmentDisplayStatus({ status: "CONFIRMED", whatsapp_response_status: "CONFIRMED_BY_WHATSAPP" })).toEqual({ label: "Confirmado", tone: "success" });
    expect(appointmentDisplayStatus({ status: "CANCELED", whatsapp_response_status: "CANCELED_BY_WHATSAPP" })).toEqual({ label: "Cancelado - horário liberado", tone: "danger" });
    expect(appointmentDisplayStatus({ status: "CONFIRMED", whatsapp_response_status: "CONTACT_REQUESTED_BY_WHATSAPP" })).toEqual({ label: "Solicitado Contato", tone: "contact" });
    expect(appointmentDisplayStatus({ status: "CONFIRMED", whatsapp_response_status: "CONFIRMED_MANUALLY" })).toEqual({ label: "Confirmado Manualmente", tone: "success" });
  });
});
