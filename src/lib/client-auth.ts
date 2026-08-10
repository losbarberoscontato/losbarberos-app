import { z } from "zod";
import { normalizeTenantSlug } from "@/components/connected-client/format";
import { normalizeSafeReturnPath } from "@/lib/integrations/state";

const defaultClientDestination = "/cliente";
const clientDestinations = new Set([
  defaultClientDestination,
  "/cliente/agendar",
  "/cliente/reservas",
  "/cliente/perfil",
]);

function isValidIsoDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export const clientSignupSchema = z.object({
  fullName: z.string().trim().min(1),
  phoneE164: z.string().regex(/^\+[1-9]\d{1,14}$/u),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z
    .string()
    .min(8)
    .regex(/\p{L}/u)
    .regex(/\p{N}/u)
    .regex(/[^\p{L}\p{N}]/u),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine(isValidIsoDate),
  acceptedTerms: z.literal(true),
});

export function clientAuthDestination(input: {
  next?: string | null;
  slug?: string | null;
}): string {
  const normalizedPath = normalizeSafeReturnPath(input.next, defaultClientDestination);
  const destination = clientDestinations.has(normalizedPath)
    ? normalizedPath
    : defaultClientDestination;
  const slug = normalizeTenantSlug(input.slug);

  return slug ? `${destination}?barbearia=${encodeURIComponent(slug)}` : destination;
}
