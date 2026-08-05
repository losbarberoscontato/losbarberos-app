import type { BillingStatus } from "@/lib/domain/types";

export interface AdminOrganization {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  created_at: string;
}

export interface AdminSubscription {
  id: string;
  organization_id: string;
  stripe_price_id: string | null;
  status: BillingStatus;
  trial_ends_at: string | null;
  current_period_ends_at: string | null;
  grace_ends_at: string | null;
  canceled_at: string | null;
  retention_ends_at: string | null;
  updated_at: string;
}

export interface AdminAccessEvent {
  id: number | string;
  organization_id: string;
  from_status: BillingStatus | null;
  to_status: BillingStatus;
  reason: string;
  created_at: string;
}

export interface AdminControlPlaneData {
  organizations: AdminOrganization[];
  subscriptions: AdminSubscription[];
  accessEvents: AdminAccessEvent[];
  errors: string[];
  loadedAt: string;
  accessEventLimit: number;
}
