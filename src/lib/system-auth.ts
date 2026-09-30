import { productLoginPath, type ProductKey } from "@/lib/product-routes";

export type SystemAuthMode = "signin" | "signup";

const systemAuthDestinations = new Set([
  "/gestor",
  "/onboarding",
  "/regularizacao",
  "/le-gras/regularizacao",
  "/music-pro/regularizacao",
  "/display-admin",
]);

export function resolveSystemAuthMode(
  value: string | string[] | undefined,
): SystemAuthMode {
  return value === "cadastro" ? "signup" : "signin";
}

export function resolveSystemAuthDestination(
  value: string | string[] | undefined,
): string {
  return typeof value === "string" && systemAuthDestinations.has(value)
    ? value
    : "/gestor";
}

export function systemLoginHref(
  mode: SystemAuthMode,
  nextPath = "/gestor",
  productKey?: ProductKey,
): string {
  const params = new URLSearchParams({
    modo: mode === "signup" ? "cadastro" : "login",
  });
  const destination = resolveSystemAuthDestination(nextPath);

  if (destination !== "/gestor") {
    params.set("next", destination);
  }

  const route = productLoginPath(productKey ?? "los-barberos");
  return `${route}?${params.toString()}`;
}
