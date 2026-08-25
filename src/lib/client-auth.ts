import { z } from "zod";
import { normalizeTenantSlug } from "@/components/connected-client/format";
import { normalizeSafeReturnPath } from "@/lib/integrations/state";

const defaultClientDestination = "/cliente/agendar";
const clientDestinations = new Set([
  defaultClientDestination,
  "/cliente",
  "/cliente/agendar",
  "/cliente/reservas",
  "/cliente/perfil",
]);

function isValidIsoDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export const clientPasswordSchema = z
  .string()
  .min(8)
  .regex(/\p{L}/u)
  .regex(/\p{N}/u)
  .regex(/[^\p{L}\p{N}]/u);

export const clientSignupSchema = z.object({
  fullName: z.string().trim().min(2).max(160),
  phoneE164: z.string().regex(/^[+][1-9][0-9]{7,14}$/u),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: clientPasswordSchema,
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine(isValidIsoDate),
  acceptedTerms: z.literal(true),
});

export function clientAuthDestination(input: {
  next?: string | null;
  slug?: string | null;
}): string {
  const normalizedPath = normalizeSafeReturnPath(input.next, defaultClientDestination);
  const nextUrl = new URL(normalizedPath, "https://cliente.local");
  const destination = clientDestinations.has(nextUrl.pathname)
    ? nextUrl.pathname
    : defaultClientDestination;
  const slug = normalizeTenantSlug(input.slug);
  const params = new URLSearchParams();
  if (slug) params.set("barbearia", slug);
  if (destination === "/cliente/agendar") {
    const barberId = nextUrl.searchParams.get("barbeiro");
    const startsAt = nextUrl.searchParams.get("horario");
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(barberId ?? "")) {
      params.set("barbeiro", barberId!);
    }
    if (startsAt && !Number.isNaN(new Date(startsAt).getTime())) params.set("horario", startsAt);
  }
  const query = params.toString();
  return query ? `${destination}?${query}` : destination;
}

export function clientOAuthCompletionDestination(input: {
  next?: string | null;
  slug?: string | null;
}): string {
  const destination = new URL(clientAuthDestination(input), "https://cliente.local");
  const nextParams = new URLSearchParams(destination.searchParams);
  nextParams.delete("barbearia");
  const nextQuery = nextParams.toString();
  const params = new URLSearchParams({
    oauth: "complete",
    next: nextQuery ? `${destination.pathname}?${nextQuery}` : destination.pathname,
  });
  const slug = destination.searchParams.get("barbearia");
  if (slug) params.set("barbearia", slug);
  return `/cliente/entrar?${params.toString()}`;
}
