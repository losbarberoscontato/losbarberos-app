"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { humanizeError } from "./format";

export function connectedClient(): SupabaseClient {
  const client = getSupabaseBrowserClient();
  if (!client) throw new Error("Supabase não configurado.");
  return client;
}

export async function assertResult(result: { error: { message: string } | null }) {
  if (result.error) throw new Error(result.error.message);
}

export async function runMutation(
  setMessage: (message: string) => void,
  mutation: () => Promise<void>,
  success: string,
) {
  setMessage("Salvando…");
  try {
    await mutation();
    setMessage(success);
    return true;
  } catch (error) {
    setMessage(humanizeError(error));
    return false;
  }
}

