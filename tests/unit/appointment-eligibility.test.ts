import { describe, expect, it } from "vitest";
import { eligibleBarbersForAppointmentSelection } from "@/components/connected-manager/appointment-eligibility";

const barbers = [{ id: "julio" }, { id: "carlos" }, { id: "ana" }];
const assignments = [
  { barber_id: "carlos", service_id: "foto", active: true },
  { barber_id: "julio", service_id: "foto", active: false },
  { barber_id: "carlos", service_id: "video", active: true },
  { barber_id: "ana", service_id: "video", active: true },
];

describe("eligible barbers for manual appointments", () => {
  it("returns only professionals with an active assignment for a service", () => {
    expect(eligibleBarbersForAppointmentSelection("SERVICE:foto", barbers, assignments, [])).toEqual([{ id: "carlos" }]);
  });

  it("requires a professional to be assigned every active service in a package", () => {
    expect(eligibleBarbersForAppointmentSelection("PACKAGE:studio", barbers, assignments, [
      { package_id: "studio", service_id: "foto", active: true },
      { package_id: "studio", service_id: "video", active: true },
      { package_id: "studio", service_id: "other", active: false },
    ])).toEqual([{ id: "carlos" }]);
  });

  it("returns no choices when the selection has no active service assignments", () => {
    expect(eligibleBarbersForAppointmentSelection("SERVICE:other", barbers, assignments, [])).toEqual([]);
  });
});
