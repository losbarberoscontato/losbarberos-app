const DAY_MS = 86_400_000;

export const TENANT_EXPORT_WINDOW_DAYS = 30;

export type ConsentPurpose = "WHATSAPP_TRANSACTIONAL" | "MARKETING" | "PRIVACY_POLICY";

export interface ConsentEvent {
  purpose: ConsentPurpose;
  granted: boolean;
  occurredAt: Date;
  noticeVersion: string;
  source: "ONBOARDING" | "PROFILE" | "WHATSAPP" | "SUPPORT";
}

export function latestConsent(events: ConsentEvent[], purpose: ConsentPurpose): boolean {
  const relevant = events
    .filter((event) => event.purpose === purpose)
    .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime());
  return relevant[0]?.granted ?? false;
}

export function calculateTenantPurgeAfter(canceledAt: Date): Date {
  if (Number.isNaN(canceledAt.getTime())) throw new RangeError("Invalid cancellation date");
  return new Date(canceledAt.getTime() + TENANT_EXPORT_WINDOW_DAYS * DAY_MS);
}
