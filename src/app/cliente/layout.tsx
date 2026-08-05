import type { Metadata } from "next";
import { ClientShell } from "@/components/client-shell";
import { ConnectedClientShell } from "@/components/connected-client/shell";
import { hasSupabaseConfig } from "@/lib/env";

export const metadata: Metadata = { title: "Cliente" };

export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  if (hasSupabaseConfig) return <ConnectedClientShell>{children}</ConnectedClientShell>;
  return <ClientShell demoMode>{children}</ClientShell>;
}
