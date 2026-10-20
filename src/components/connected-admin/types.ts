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
  modules?: AdminModule[];
  modulePrices?: AdminModulePrice[];
  kanbanPrices?: AdminKanbanPrice[];
}

export interface AdminModule { key: string; name: string; description: string; active: boolean; }
export interface AdminModulePrice { module_key: string; monthly_price_cents: number; effective_from: string; effective_until: string | null; }
export interface AdminKanbanPrice { id: string; product_key: string; monthly_price_cents: number; stripe_test_price_id: string; stripe_live_price_id: string; contract_version: string; contract_body: string; published_at: string; retired_at: string | null; }
