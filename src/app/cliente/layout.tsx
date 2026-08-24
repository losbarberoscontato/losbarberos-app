import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ClientShell } from "@/components/client-shell";
import { ConnectedClientShell } from "@/components/connected-client/shell";
import { hasSupabaseConfig } from "@/lib/env";

export const metadata: Metadata = { title: "Cliente" };

const clientSans = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-client-sans",
});

export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={clientSans.variable}>
      {hasSupabaseConfig
        ? <ConnectedClientShell>{children}</ConnectedClientShell>
        : <ClientShell demoMode>{children}</ClientShell>}
    </div>
  );
}
