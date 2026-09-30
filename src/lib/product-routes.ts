export type ProductKey = "los-barberos" | "le-gras" | "music-pro";

export function productBillingPath(productKey: ProductKey): string {
  if (productKey === "le-gras") return "/le-gras/regularizacao";
  if (productKey === "music-pro") return "/music-pro/regularizacao";
  return "/regularizacao";
}

export function productLoginPath(productKey: ProductKey): string {
  if (productKey === "le-gras") return "/le-gras/entrar";
  if (productKey === "music-pro") return "/music-pro/entrar";
  return "/los-barberos/entrar";
}
