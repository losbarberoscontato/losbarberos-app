import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isProductIdentityConfig, LE_GRAS_IDENTITY_FALLBACK, MUSIC_PRO_IDENTITY_FALLBACK, type ProductIdentityConfig } from "@/lib/product-identity";

function fallbackIdentity(productKey: string): ProductIdentityConfig | null {
  if (productKey === "le-gras") return LE_GRAS_IDENTITY_FALLBACK;
  if (productKey === "music-pro") return MUSIC_PRO_IDENTITY_FALLBACK;
  return null;
}

export async function getPublishedProductIdentity(productKey: string): Promise<ProductIdentityConfig | null> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return fallbackIdentity(productKey);
  const { data, error } = await supabase.from("platform_product_identities").select("config").eq("product_key", productKey).maybeSingle();
  return !error && isProductIdentityConfig(data?.config)
    ? data.config
    : fallbackIdentity(productKey);
}

export async function getPublishedProductIdentities(): Promise<Record<string, ProductIdentityConfig>> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return {};
  const { data, error } = await supabase.from("platform_product_identities").select("product_key,config");
  if (error) return {};
  return Object.fromEntries((data ?? []).filter((row) => isProductIdentityConfig(row.config)).map((row) => [row.product_key, row.config]));
}
