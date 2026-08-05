import { IntegrationError } from "./security.ts";

export function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new IntegrationError(500, "SERVER_CONFIGURATION_ERROR");
  return value;
}

export function appOrigin(): string {
  const configured = Deno.env.get("APP_URL") ??
    Deno.env.get("NEXT_PUBLIC_APP_URL");

  try {
    return new URL(configured ?? "http://localhost:3000").origin;
  } catch {
    throw new IntegrationError(500, "SERVER_CONFIGURATION_ERROR");
  }
}

export function functionUrl(name: string): string {
  const base = requiredEnv("SUPABASE_URL").replace(/\/$/u, "");
  return `${base}/functions/v1/${name}`;
}
