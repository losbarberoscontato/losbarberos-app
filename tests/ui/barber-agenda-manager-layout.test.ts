import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/components/connected-barber/agenda.tsx"), "utf8");

describe("barber agenda manager layout", () => {
  it("uses the manager calendar layouts instead of the former appointment list", () => {
    expect(source).toContain('className="agenda-day panel"');
    expect(source).toContain('className="panel agenda-week"');
    expect(source).toContain('className="panel agenda-month"');
    expect(source).toContain('aria-label="Visualização da agenda"');
  });

  it("keeps own-agenda filtering and only calls barber-scoped mutations", () => {
    expect(source).toContain('const ownAgenda = context.agenda_access_scope === "OWN"');
    expect(source).toContain('appointment.barber_id === context.barber_id');
    expect(source).toContain('"barber_transition_appointment"');
    expect(source).toContain('"barber_cancel_appointment"');
    expect(source).toContain('"record_barber_appointment_receipt"');
    expect(source).toContain('A confirmação manual é gerenciada pelo Gestor.');
  });
});
