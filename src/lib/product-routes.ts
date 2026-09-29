export type ProductKey = "los-barberos" | "le-gras";

export function productBillingPath(productKey: ProductKey): string {
  return productKey === "le-gras" ? "/le-gras/regularizacao" : "/regularizacao";
}
