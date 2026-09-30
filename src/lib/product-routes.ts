export type ProductKey = "los-barberos" | "le-gras" | "pro-stetic" | "music-pro";

export function productBillingPath(productKey: ProductKey): string {
  if (productKey === "le-gras") return "/le-gras/regularizacao";
  if (productKey === "music-pro") return "/music-pro/regularizacao";
  if (productKey === "pro-stetic") return "/pro-stetic/regularizacao";
  return "/regularizacao";
}

export function productLoginPath(productKey: ProductKey): string {
  if (productKey === "le-gras") return "/le-gras/entrar";
  if (productKey === "music-pro") return "/music-pro/entrar";
  if (productKey === "pro-stetic") return "/pro-stetic/entrar";
  return "/los-barberos/entrar";
}
