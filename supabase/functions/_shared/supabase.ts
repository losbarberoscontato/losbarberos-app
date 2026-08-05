import {
  createClient,
  type SupabaseClient,
  type User,
} from "npm:@supabase/supabase-js@2.112.0";

import { requiredEnv } from "./env.ts";
import { timingSafeEqual } from "./crypto.ts";
import { IntegrationError } from "./security.ts";

export function serviceClient(): SupabaseClient {
  return createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}

export async function requireUser(request: Request): Promise<User> {
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/iu)?.[1];
  if (!token) throw new IntegrationError(401, "AUTH_REQUIRED");

  const client = createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_ANON_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new IntegrationError(401, "INVALID_AUTH");
  return data.user;
}

export async function requireOrganizationOwner(
  organizationId: string,
  userId: string,
): Promise<void> {
  const { data, error } = await serviceClient().rpc(
    "authorize_organization_owner",
    {
      p_organization_id: organizationId,
      p_user_id: userId,
    },
  );

  if (error) {
    throw new IntegrationError(500, "AUTHORIZATION_CHECK_FAILED", true);
  }
  if (data !== true) throw new IntegrationError(403, "OWNER_REQUIRED");
}

export function requireServiceInvocation(request: Request): void {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/iu)
    ?.[1];
  const expected = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!token || !timingSafeEqual(token, expected)) {
    throw new IntegrationError(401, "SERVICE_AUTH_REQUIRED");
  }
}

export async function rpc<T>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await serviceClient().rpc(name, args);
  if (error) {
    console.error("integration_rpc_error", { name, code: error.code });
    throw new IntegrationError(500, "PERSISTENCE_ERROR", true);
  }
  return data as T;
}
