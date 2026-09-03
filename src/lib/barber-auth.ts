import { normalizeSafeReturnPath } from "@/lib/integrations/state";
import { normalizeTenantSlug } from "@/components/connected-client/format";

const defaultBarberDestination = "/barbeiro";
const barberDestinations = new Set([
  "/barbeiro",
  "/barbeiro/agenda",
  "/barbeiro/caixa",
  "/barbeiro/perfil",
]);

export function barberAuthDestination(input: {
  next?: string | null;
  slug?: string | null;
}): string {
  const normalizedPath = normalizeSafeReturnPath(input.next, defaultBarberDestination);
  const destination = new URL(normalizedPath, "https://barbeiro.local");
  const pathname = barberDestinations.has(destination.pathname)
    ? destination.pathname
    : defaultBarberDestination;
  const slug = normalizeTenantSlug(input.slug);
  return slug ? `${pathname}?barbearia=${encodeURIComponent(slug)}` : pathname;
}

export function barberLoginHref(next = defaultBarberDestination, slug?: string | null): string {
  const destination = barberAuthDestination({ next, slug });
  const url = new URL(destination, "https://barbeiro.local");
  const params = new URLSearchParams({ next: url.pathname });
  const normalizedSlug = url.searchParams.get("barbearia");
  if (normalizedSlug) params.set("barbearia", normalizedSlug);
  return `/barbeiro/entrar?${params.toString()}`;
}
