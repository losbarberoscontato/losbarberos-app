export type ProductIdentityConfig = {
  brand: { name: string; tagline: string; mark: string; logoUrl: string };
  colors: Record<string, string>;
  fonts: { interface: string; display: string };
  vocabulary: Record<string, string>;
};

export function isProductIdentityConfig(value: unknown): value is ProductIdentityConfig {
  if (!value || typeof value !== "object") return false;
  const config = value as Partial<ProductIdentityConfig>;
  return Boolean(config.brand && config.colors && config.fonts && config.vocabulary);
}
