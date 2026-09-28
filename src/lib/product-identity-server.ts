import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isProductIdentityConfig, type ProductIdentityConfig } from "@/lib/product-identity";

export async function getPublishedProductIdentity(productKey: string): Promise<ProductIdentityConfig | null> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return null;
  const { data, error } = await supabase.from("platform_product_identities").select("config").eq("product_key", productKey).maybeSingle();
  return !error && isProductIdentityConfig(data?.config) ? data.config : null;
}

export async function getPublishedProductIdentities(): Promise<Record<string, ProductIdentityConfig>> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return {};
  const { data, error } = await supabase.from("platform_product_identities").select("product_key,config");
  if (error) return {};
  return Object.fromEntries((data ?? []).filter((row) => isProductIdentityConfig(row.config)).map((row) => [row.product_key, row.config]));
}
