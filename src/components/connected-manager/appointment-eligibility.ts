type BarberChoice = { id: string };
type BarberServiceAssignment = { barber_id: string; service_id: string; active: boolean };
type PackageService = { package_id: string; service_id: string; active: boolean };

export function eligibleBarbersForAppointmentSelection<T extends BarberChoice>(
  selection: string,
  barbers: T[],
  assignments: BarberServiceAssignment[],
  packageItems: PackageService[],
) {
  const [type, id] = selection.split(":");
  const serviceIds = type === "SERVICE" && id
    ? [id]
    : type === "PACKAGE" && id
      ? packageItems.filter((item) => item.package_id === id && item.active).map((item) => item.service_id)
      : [];

  if (!serviceIds.length) return [];
  return barbers.filter((barber) => serviceIds.every((serviceId) => assignments.some((assignment) =>
    assignment.barber_id === barber.id && assignment.service_id === serviceId && assignment.active,
  )));
}
