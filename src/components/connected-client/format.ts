import type {
  AppointmentItem,
  BookingSelection,
  CatalogChoice,
  PublicBookingContext,
} from "@/components/connected-client/types";

export const tenantStorageKey = "los-barberos:client-tenant";

export function normalizeTenantSlug(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(normalized) ? normalized : null;
}

export function resolveTenantSlug(
  queryValue: string | null | undefined,
  storedValue: string | null | undefined,
  initialValue?: string | null,
): string | null {
  return normalizeTenantSlug(initialValue) ?? normalizeTenantSlug(queryValue) ?? normalizeTenantSlug(storedValue);
}

export function catalogChoices(context: PublicBookingContext): CatalogChoice[] {
  return [
    ...context.services.map((service) => ({
      id: service.id,
      kind: "SERVICE" as const,
      name: service.name,
      description: service.description,
      priceCents: service.price_cents,
      durationMinutes: service.duration_minutes,
      audiences: service.audiences,
    })),
    ...context.packages.map((item) => ({
      id: item.id,
      kind: "PACKAGE" as const,
      name: item.name,
      description: item.description,
      priceCents: item.price_cents,
      durationMinutes: item.items.reduce(
        (total, packageItem) => total + packageItem.duration_minutes * packageItem.quantity,
        0,
      ),
      audiences: item.audiences,
    })),
  ];
}

export function bookingSelection(choice: CatalogChoice): BookingSelection[] {
  return choice.kind === "SERVICE"
    ? [{ service_id: choice.id, quantity: 1 }]
    : [{ package_id: choice.id, quantity: 1 }];
}

export function serviceIdsForChoice(
  context: PublicBookingContext,
  choice: CatalogChoice,
): string[] {
  if (choice.kind === "SERVICE") return [choice.id];
  return context.packages
    .find((item) => item.id === choice.id)
    ?.items.map((item) => item.service_id) ?? [];
}

export function barberSupportsServices(
  serviceIds: string[],
  barberServiceIds: string[] | undefined,
): boolean {
  return barberServiceIds === undefined ||
    serviceIds.every((serviceId) => barberServiceIds.includes(serviceId));
}

export function selectionsFromAppointmentItems(items: AppointmentItem[]): BookingSelection[] {
  const groups = new Map<string, AppointmentItem[]>();
  for (const item of items) {
    groups.set(item.selection_key, [...(groups.get(item.selection_key) ?? []), item]);
  }
  return [...groups.values()].map((group) => {
    const first = group[0];
    return first.source === "PACKAGE" && first.package_id
      ? { package_id: first.package_id, quantity: 1 }
      : { service_id: first.service_id, quantity: first.quantity };
  });
}

export function formatMoney(cents: number, currency = "BRL"): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(cents / 100);
}

export function localToday(timezone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

export function addCalendarDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return date.toISOString().slice(0, 10);
}

export function dateOptions(timezone: string, count = 16, now = new Date()): string[] {
  const today = localToday(timezone, now);
  return Array.from({ length: count }, (_, index) => addCalendarDays(today, index));
}

export function formatLocalDate(isoDate: string, options?: Intl.DateTimeFormatOptions): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "UTC",
    weekday: "short",
    day: "2-digit",
    month: "short",
    ...options,
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

export function formatInstant(instant: string, timezone: string, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: "short",
    ...options,
  }).format(new Date(instant));
}

export function formatSlotTime(instant: string, timezone: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(instant));
}

export function parsePostgresRange(range: string): { startsAt: string; endsAt: string } {
  const match = range.match(/^[[(`"]?([^,"]+)[,"]+([^\])"]+)[\])]/u);
  if (match) return { startsAt: match[1], endsAt: match[2] };
  const clean = range.replace(/^[[(]/u, "").replace(/[\])]$/u, "");
  const [startsAt = "", endsAt = ""] = clean.split(",").map((value) => value.replace(/^"|"$/gu, ""));
  return { startsAt, endsAt };
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? "Cliente").trim().split(/\s+/u).filter(Boolean);
  return `${parts[0]?.[0] ?? "C"}${parts.length > 1 ? parts.at(-1)?.[0] ?? "" : ""}`.toUpperCase();
}

export function locationLabel(address: Record<string, unknown> | undefined): string {
  if (!address) return "Endereço informado na confirmação";
  const values = [address.street, address.number, address.neighborhood, address.city, address.state]
    .filter((value): value is string | number => typeof value === "string" || typeof value === "number")
    .map(String)
    .filter(Boolean);
  return values.length ? values.join(" · ") : "Endereço informado na confirmação";
}

export function canCustomerReschedule(
  status: string,
  startsAt: string,
  leadMinutes: number,
  acceptingBookings: boolean,
  now = new Date(),
): boolean {
  if (status !== "CONFIRMED" || !acceptingBookings) return false;
  return now.getTime() <= new Date(startsAt).getTime() - leadMinutes * 60_000;
}

export function isMercadoPagoCheckoutUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (
      url.hostname === "mercadopago.com.br" || url.hostname.endsWith(".mercadopago.com.br")
    );
  } catch {
    return false;
  }
}
